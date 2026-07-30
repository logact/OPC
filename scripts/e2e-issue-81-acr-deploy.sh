#!/usr/bin/env bash
# E2E verification for issue #81 — docker server 部署太慢(镜像下载耗时)
#
# 验收标准(align gate 批准版):
#   AC1 依赖层变化时,部署机 docker pull server 镜像 ≤ 120s
#       (对照基线:2026-07-29 部署从 ghcr.io 拉 76MB 依赖层耗时 37 分钟)
#   AC2 拉下的镜像可正常运行(node runtime 可用)
#   AC3 ACR 与 ghcr 同 tag 镜像 digest 一致(CI 双推正确,ghcr 行为不破坏)
#   AC4 CI/deploy workflow 已接线:ci.yml + build-mosquitto.yml 推送 ACR,
#       deploy.yml 的 SERVER_IMAGE / MOSQUITTO_IMAGE 指向 ACR
#
# 用法:
#   scripts/e2e-issue-81-acr-deploy.sh <tag>
#   tag: 某次 CI 构建产生的镜像 tag(如 sha-<commit> 或版本号)。
#        为模拟"依赖层变化"场景,应选择一个部署机上尚未缓存的 tag。
#
# 环境变量:
#   SSH_TARGET     若设置(如 logact@192.168.1.51),拉取计时在该远程部署机上执行;
#                  否则在本机执行(在部署机本机上运行时不设)。
#   ACR_REGISTRY   默认 crpi-isw06ybiu6gijjhd.cn-shenzhen.personal.cr.aliyuncs.com
#   ACR_NAMESPACE  默认 logact
#   PULL_BUDGET_SECONDS  默认 120
#
# 退出码: 0 = 全部通过; 1 = 任一检查失败。

set -u

TAG="${1:?usage: $0 <image-tag>}"
ACR_REGISTRY="${ACR_REGISTRY:-crpi-isw06ybiu6gijjhd.cn-shenzhen.personal.cr.aliyuncs.com}"
ACR_NAMESPACE="${ACR_NAMESPACE:-logact}"
PULL_BUDGET_SECONDS="${PULL_BUDGET_SECONDS:-120}"
GHCR_IMAGE="ghcr.io/logact/opc-server:${TAG}"
ACR_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/opc-server:${TAG}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

FAILED=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILED=1; }

run_remote() {
  if [ -n "${SSH_TARGET:-}" ]; then
    ssh -o BatchMode=yes "$SSH_TARGET" "$@"
  else
    "$@"
  fi
}

echo "== AC4: workflow 静态检查 =="
if grep -q 'ACR_REGISTRY' "$REPO_ROOT/.github/workflows/ci.yml" \
  && grep -q 'ACR_REGISTRY' "$REPO_ROOT/.github/workflows/build-mosquitto.yml"; then
  pass "ci.yml 与 build-mosquitto.yml 包含 ACR 推送配置"
else
  fail "ci.yml / build-mosquitto.yml 缺少 ACR 推送配置"
fi
if grep -q 'ACR' "$REPO_ROOT/.github/workflows/deploy.yml"; then
  pass "deploy.yml 引用 ACR 镜像地址"
else
  fail "deploy.yml 未引用 ACR 镜像地址"
fi

echo "== AC1: 部署机拉取 ${ACR_IMAGE} 计时(预算 ${PULL_BUDGET_SECONDS}s) =="
# 先删掉本地已有的同 tag 镜像,确保计时反映真实下载而非缓存命中
run_remote docker rmi "$ACR_IMAGE" >/dev/null 2>&1 || true
START=$(date +%s)
if run_remote docker pull "$ACR_IMAGE" >/dev/null 2>&1; then
  ELAPSED=$(( $(date +%s) - START ))
  echo "拉取耗时: ${ELAPSED}s"
  if [ "$ELAPSED" -le "$PULL_BUDGET_SECONDS" ]; then
    pass "拉取在预算内(${ELAPSED}s ≤ ${PULL_BUDGET_SECONDS}s)"
  else
    fail "拉取超时(${ELAPSED}s > ${PULL_BUDGET_SECONDS}s)"
  fi
else
  fail "docker pull ${ACR_IMAGE} 失败(镜像不存在或 registry 不可达)"
fi

echo "== AC2: 镜像可运行 =="
if run_remote docker run --rm "$ACR_IMAGE" node -e "console.log('node ok')" 2>/dev/null | grep -q "node ok"; then
  pass "镜像内 node runtime 正常"
else
  fail "镜像无法运行 node"
fi

echo "== AC3: ACR 与 ghcr digest 一致 =="
ACR_DIGEST=$(run_remote docker inspect --format '{{index .RepoDigests 0}}' "$ACR_IMAGE" 2>/dev/null | grep -oE 'sha256:[a-f0-9]+' || true)
GHCR_DIGEST=$(run_remote docker manifest inspect "$GHCR_IMAGE" 2>/dev/null \
  | python3 -c "import sys,json; m=json.load(sys.stdin); print(m.get('config',{}).get('digest') or '')" 2>/dev/null || true)
# manifest list 场景: 比对 ACR RepoDigests 中的 digest 与 ghcr manifest digest
GHCR_MD=$(run_remote docker buildx imagetools inspect "$GHCR_IMAGE" 2>/dev/null | grep -oE 'sha256:[a-f0-9]+' | head -1 || true)
if [ -n "$ACR_DIGEST" ] && [ -n "$GHCR_MD" ]; then
  if [ "$ACR_DIGEST" = "$GHCR_MD" ]; then
    pass "digest 一致: $ACR_DIGEST"
  else
    fail "digest 不一致: ACR=$ACR_DIGEST ghcr=$GHCR_MD"
  fi
else
  fail "无法获取 digest(ACR='$ACR_DIGEST' ghcr='$GHCR_MD')"
fi

echo
if [ "$FAILED" -eq 0 ]; then
  echo "ALL CHECKS PASSED"
else
  echo "SOME CHECKS FAILED"
fi
exit "$FAILED"
