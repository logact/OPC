#!/usr/bin/env bash
# Maestro 套件的 CI 入口（iOS simulator，由 ci-mobile-e2e.yml 调用）：
#  1. preflight：server / MQTT-WS / Metro 可达性检查。基础设施挂了就以
#     "环境故障" 注解快速失败，而不是让一堆 flow 报误导性的断言错误。
#  2. 按文件名字典序逐 flow 执行，任一 flow 失败立即整体失败（fail-fast）：
#     不重跑、不继续后续 flow。失败成本 ~40min 的全量跑法已被放弃。
#
# 注意：macOS runner 的 /bin/bash 是 3.2，不要用 bash 4+ 语法（关联数组等）。
set -uo pipefail

OPC_SERVER_URL="${OPC_SERVER_URL:-http://localhost:3000}"
MQTT_WS_HOST="${MQTT_WS_HOST:-localhost}"
MQTT_WS_PORT="${MQTT_WS_PORT:-9001}"
METRO_PORT="${METRO_PORT:-8081}"
RESULTS_DIR="maestro-results"
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

# --- 2. 逐 flow fail-fast ----------------------------------------------------
# flow 头部 tags: 块与 EXCLUDE_TAGS 有交集则跳过（YAML 简单解析，按本仓库
# flows 的固定格式：tags: 起、--- 止、'  - tag' 行）。
is_excluded() {
  local flow_tags ft
  flow_tags="$(sed -n '/^tags:/,/^---/p' "$1" | sed -n 's/^ *- *//p')"
  for ft in $flow_tags; do
    case ",$EXCLUDE_TAGS," in
      *,"$ft",*) return 0 ;;
    esac
  done
  return 1
}

for flow in .maestro/flows/*.yaml; do
  name="$(basename "$flow" .yaml)"
  if is_excluded "$flow"; then
    echo "SKIP $name (tag in exclude list: $EXCLUDE_TAGS)"
    continue
  fi
  echo "=== RUN $name ==="
  # -e OPC_SERVER_URL：让 subflows/seed.yaml 打到与 preflight 一致的服务器
  # （seed-participants.js 默认 localhost:3000，CI 里服务器是外部的）
  if maestro test "$flow" -e OPC_SERVER_URL="$OPC_SERVER_URL" \
      --format junit --output "$RESULTS_DIR/$name.xml"; then
    echo "PASS $name"
  else
    echo "::error title=Maestro flow failed::$name failed. Fail-fast: remaining flows skipped, no retry."
    exit 1
  fi
done

echo "All flows passed."
