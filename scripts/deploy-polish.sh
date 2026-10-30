#!/bin/bash
# 部署：缓存策略修复（HTML/sw 不缓存）+ 视觉对齐
set -euo pipefail
APP=/var/www/monitor-v2
SRC=/root/northland-stage6

rm -rf "$SRC" && mkdir -p "$SRC"
tar -xzf /root/northland-fe6.tar.gz -C "$SRC"

echo "=== 1. 前端 ==="
rsync -a --delete "$SRC/web/dist/" "$APP/web/dist/"

echo "=== 2. 服务端（缓存头策略）==="
rsync -a "$SRC/server/src/" "$APP/server/src/"
node --check "$APP/server/src/index.js" && echo "  语法 OK"

echo "=== 3. 重启 ==="
pm2 restart monitor-v2 --update-env >/dev/null
sleep 5
curl -s --max-time 8 https://monitor.xuanjian.top/api/health
echo

echo "=== 4. 缓存头核对 ==="
echo -n "  index.html: "; curl -sI --max-time 8 https://monitor.xuanjian.top/ | grep -i '^cache-control' | tr -d '\r'
echo -n "  sw.js: "; curl -sI --max-time 8 https://monitor.xuanjian.top/sw.js | grep -i '^cache-control' | tr -d '\r'
echo -n "  manifest: "; curl -sI --max-time 8 https://monitor.xuanjian.top/manifest.webmanifest | grep -i '^cache-control' | tr -d '\r'
ASSET=$(curl -s --max-time 8 https://monitor.xuanjian.top/ | grep -o '/assets/index-[^"]*\.js' | head -1)
echo -n "  $ASSET: "; curl -sI --max-time 8 "https://monitor.xuanjian.top$ASSET" | grep -i '^cache-control' | tr -d '\r'

echo
echo "=== 5. 当前构建索引（含 SW 重置脚本）==="
curl -s --max-time 8 https://monitor.xuanjian.top/ | grep -c 'nl_monitor_sw_reset_v4' | sed 's/^/  sw reset script 出现次数: /'
