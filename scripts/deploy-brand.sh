#!/bin/bash
# 部署品牌化版本（前端 + 服务端）并重启
set -euo pipefail
APP=/var/www/monitor-v2
SRC=/root/northland-stage

rm -rf "$SRC" && mkdir -p "$SRC"
tar -xzf /root/northland-build.tar.gz -C "$SRC"

echo "=== 1. 同步前端 ==="
mkdir -p "$APP/web"
rsync -a --delete "$SRC/web/dist/" "$APP/web/dist/"
echo "  已同步 $(find "$APP/web/dist" -type f | wc -l) 个文件"

echo "=== 2. 同步服务端 ==="
rsync -a "$SRC/server/src/" "$APP/server/src/"
node --check "$APP/server/src/index.js" && echo "  语法 OK"

echo "=== 3. 重启 ==="
pm2 restart monitor-v2 --update-env >/dev/null
sleep 5

echo "=== 4. 验证 ==="
curl -s --max-time 8 https://monitor.xuanjian.top/api/health
echo
echo -n "  首页 HTTP: "
curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 https://monitor.xuanjian.top/
echo -n "  logo 资源: "
curl -s -o /dev/null -w '%{http_code} %{size_download}B\n' --max-time 10 https://monitor.xuanjian.top/logo.png
echo -n "  背景图资源: "
curl -s -o /dev/null -w '%{http_code} %{size_download}B\n' --max-time 10 https://monitor.xuanjian.top/studio.jpg
echo -n "  标题: "
curl -s --max-time 10 https://monitor.xuanjian.top/ | grep -o '<title>[^<]*</title>'
