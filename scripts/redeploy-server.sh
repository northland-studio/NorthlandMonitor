#!/bin/bash
# 完整重新部署 monitor-v2：同步代码 → 安装依赖 → 重启 → 健康检查
set -euo pipefail
APP=/var/www/monitor-v2
SRC=/root/monitor-v2-stage

mkdir -p "$APP/server"
rsync -a "$SRC/server/src/" "$APP/server/src/"
rsync -a "$SRC/server/install/" "$APP/server/install/"
cp "$SRC/server/package.json" "$APP/server/package.json"
chmod +x "$APP/server/install/agent.sh" 2>/dev/null || true

cd "$APP/server"
npm install --omit=dev --silent 2>&1 | tail -3 || true
echo "  dotenv: $([ -d node_modules/dotenv ] && echo 已安装 || echo 缺失)"
echo "  better-sqlite3: $([ -d node_modules/better-sqlite3 ] && echo 已安装 || echo 缺失)"

node --check src/index.js

pm2 delete monitor-v2 >/dev/null 2>&1 || true
pm2 start src/index.js --name monitor-v2 >/dev/null
sleep 5

echo "=== 健康检查 ==="
curl -s --max-time 8 http://127.0.0.1:3004/api/health || echo "  (无响应)"
echo
echo "=== 监听端口 ==="
ss -lntp 2>/dev/null | grep -E ':300[0-9]' | head -6
echo "=== 错误日志 ==="
pm2 logs monitor-v2 --err --lines 10 --nostream 2>/dev/null | tail -10
echo "=== 运维账号 ==="
node -e "
const Database=require('better-sqlite3');
const db=new Database('$APP/server/data/monitor.db');
console.log('  ' + JSON.stringify(db.prepare('SELECT email,level,active FROM operators').all()));
process.exit(0);
" 2>/dev/null || echo "  (暂无)"
