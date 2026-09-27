#!/bin/bash
# 云游中国 3D —— SCNet 启动/监护脚本（开机由 jupyter 钩子调用，也可手动运行）
# 用法：deploy/start.sh            # 已在运行则直接退出（flock）
#       kill -TERM $(cat .run/server.pid)   # 重启 Node 进程（监护循环 3 秒后拉起）
cd "$(dirname "$0")/.." || exit 1
NODE=${NODE:-/root/private_data/.orbit-runtime/node-v24.18.0-linux-x64/bin/node}
PORT=${PORT:-8725}
BASE=${BASE_PATH:-/cloud-tour/}
mkdir -p .run
exec 9>.run/supervisor.lock
flock -n 9 || { echo "cloud-tour-3d supervisor already running"; exit 0; }

# 出网代理：SSH 会话/后台进程默认没有，取容器 PID 1 的环境
if [ -z "$HTTPS_PROXY" ] && [ -z "$https_proxy" ] && [ -r /proc/1/environ ]; then
  while IFS= read -r kv; do
    case "$kv" in http_proxy=*|https_proxy=*|HTTP_PROXY=*|HTTPS_PROXY=*) export "$kv" ;; esac
  done < <(tr '\0' '\n' < /proc/1/environ)
fi
export HTTPS_PROXY="${HTTPS_PROXY:-$https_proxy}" HTTP_PROXY="${HTTP_PROXY:-$http_proxy}"
export NO_PROXY="localhost,127.0.0.1,::1" NODE_USE_ENV_PROXY=1

while true; do
  # 日志超过 20 MB 时轮转
  if [ -f .run/server.log ] && [ "$(stat -c %s .run/server.log)" -gt 20971520 ]; then mv -f .run/server.log .run/server.log.1; fi
  echo "[$(date '+%F %T')] start node server (port $PORT, base $BASE)" >> .run/server.log
  "$NODE" server/server.mjs --host 127.0.0.1 --port "$PORT" --base "$BASE" >> .run/server.log 2>&1 &
  echo $! > .run/server.pid
  wait $!
  echo "[$(date '+%F %T')] node exited with $?" >> .run/server.log
  sleep 3
done
