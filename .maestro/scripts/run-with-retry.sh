#!/usr/bin/env bash
# Maestro 套件的 CI 入口（iOS simulator，由 ci-mobile-e2e.yml 调用）：
#  1. preflight：server / MQTT-WS / Metro 可达性检查。基础设施挂了就以
#     "环境故障" 注解快速失败，而不是让 8 个 flow 报一堆误导性的断言错误。
#  2. 跑整个套件（junit 输出）。
#  3. 解析 junit，把失败的 flow 单独重跑（最多 MAX_RERUN_ROUNDS 轮）——
#     冷启动时序类的 flake 通常重跑即过；重跑仍失败才算真失败。
# 参考 Rocket.Chat 的 .github/scripts/run-maestro.sh，按本仓库结构简化。
#
# 注意：macOS runner 的 /bin/bash 是 3.2，不要用 bash 4+ 语法（关联数组、
# 空数组展开在 set -u 下会炸），所以这里用换行分隔的字符串代替数组。
set -uo pipefail

OPC_SERVER_URL="${OPC_SERVER_URL:-http://localhost:3000}"
MQTT_WS_HOST="${MQTT_WS_HOST:-localhost}"
MQTT_WS_PORT="${MQTT_WS_PORT:-9001}"
METRO_PORT="${METRO_PORT:-8081}"
RESULTS_DIR="maestro-results"
MAIN_REPORT="$RESULTS_DIR/results.xml"
MAX_RERUN_ROUNDS="${MAX_RERUN_ROUNDS:-2}"
EXCLUDE_TAGS="${MAESTRO_EXCLUDE_TAGS:-simulation,agent-backend}"

# 慢 CI 上 XCUITest driver 启动可能远超 maestro 默认超时
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-300000}"

mkdir -p "$RESULTS_DIR"

fail_env() {
  echo "::error title=Maestro environment preflight failed::$1 This is an environment failure, not an app or test regression."
  exit 3
}

tcp_open() { (exec 3<>"/dev/tcp/$1/$2") 2>/dev/null; }

# --- 1. preflight -----------------------------------------------------------
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 --retry 2 --retry-all-errors \
  "$OPC_SERVER_URL/openapi.json" || true)"
[ "$code" = "200" ] || fail_env "OPC server $OPC_SERVER_URL/openapi.json returned HTTP ${code:-000}."
tcp_open "$MQTT_WS_HOST" "$MQTT_WS_PORT" || fail_env "MQTT WebSocket $MQTT_WS_HOST:$MQTT_WS_PORT is not accepting connections."
tcp_open localhost "$METRO_PORT" || fail_env "Metro bundler port $METRO_PORT is not accepting connections."
echo "Preflight OK: server=$OPC_SERVER_URL mqtt-ws=$MQTT_WS_HOST:$MQTT_WS_PORT metro=localhost:$METRO_PORT"

# --- 2. main suite -----------------------------------------------------------
# junit 里 testcase name 就是 flow 名（如 01-login），对应 flows/<name>.yaml
failed_flows() {
  python3 - "$1" <<'PY'
import os, sys, xml.etree.ElementTree as ET
try:
    root = ET.parse(sys.argv[1]).getroot()
except Exception:
    sys.exit(0)
for tc in root.iter('testcase'):
    if tc.find('failure') is None and tc.find('error') is None:
        continue
    name = (tc.get('name') or '').strip()
    path = os.path.join('.maestro', 'flows', name + '.yaml')
    if name and os.path.isfile(path):
        print(path)
PY
}

# -e OPC_SERVER_URL：让 subflows/seed.yaml 打到与 preflight 一致的服务器
# （seed.yaml 默认 localhost:3000，CI 里服务器是外部的）
maestro test .maestro/ --exclude-tags "$EXCLUDE_TAGS" -e OPC_SERVER_URL="$OPC_SERVER_URL" \
  --format junit --output "$MAIN_REPORT"
main_rc=$?

if [ ! -f "$MAIN_REPORT" ]; then
  echo "::error title=Maestro produced no report::The run produced no JUnit output (session/driver-startup failure). Re-run the job if this looks transient; not retrying automatically to avoid hiding real startup breakage."
  exit 1
fi

current="$(failed_flows "$MAIN_REPORT" | sort -u)"
if [ -z "$current" ]; then
  echo "All flows passed."
  exit 0
fi
echo "Main run failed flows (rc=$main_rc):"
printf '%s\n' "$current"

# --- 3. rerun failed flows ---------------------------------------------------
round=1
while [ -n "$current" ] && [ "$round" -le "$MAX_RERUN_ROUNDS" ]; do
  count="$(printf '%s\n' "$current" | wc -l | tr -d ' ')"
  echo "=== RERUN ROUND $round ($count flows) ==="
  rpt="$RESULTS_DIR/rerun-round-$round.xml"
  rm -f "$rpt"
  # flow 文件名无空格，未加引号的 $current 按换行分词（兼容 bash 3.2）
  set -f
  # shellcheck disable=SC2086
  maestro test $current -e OPC_SERVER_URL="$OPC_SERVER_URL" --format junit --output "$rpt"
  set +f
  if [ ! -f "$rpt" ]; then
    echo "Rerun produced no report; keeping last known failures."
    break
  fi
  current="$(failed_flows "$rpt" | sort -u)"
  round=$((round + 1))
done

if [ -z "$current" ]; then
  echo "All flows passed after rerun."
  exit 0
fi
echo "Still failing after $MAX_RERUN_ROUNDS rerun round(s):"
printf '%s\n' "$current"
exit 1
