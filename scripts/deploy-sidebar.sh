#!/bin/bash
# 部署：侧栏 SVG 图标 + 底部用户栏（姓名/邮箱/退出，置底）
set -euo pipefail
APP=/var/www/monitor-v2
SRC=/root/northland-stage7

rm -rf "$SRC" && mkdir -p "$SRC"
tar -xzf /root/northland-fe7.tar.gz -C "$SRC"

echo "=== 1. 前端 ==="
rsync -a --delete "$SRC/web/dist/" "$APP/web/dist/"

echo "=== 2. 服务端（/auth/me 返回 name）==="
rsync -a "$SRC/server/src/" "$APP/server/src/"
node --check "$APP/server/src/routes/api.js" && echo "  语法 OK"

echo "=== 3. 重启 ==="
pm2 restart monitor-v2 --update-env >/dev/null
sleep 5
curl -s --max-time 8 https://monitor.xuanjian.top/api/health | head -c 160
echo

echo "=== 4. 验证 /auth/me 带 name ==="
cd "$APP/server"
SID=$(node -e "
const crypto=require('crypto');
const Database=require('better-sqlite3');
const db=new Database('$APP/server/data/monitor.db');
const sid=crypto.randomBytes(24).toString('hex');
db.prepare('INSERT INTO sessions (id,email,level,ip,ua,created_at,expires_at) VALUES (?,?,?,?,?,?,?)').run(sid,'morzane_work@foxmail.com',2,'127.0.0.1','verify-name',Date.now(),Date.now()+1800000);
console.log(sid); process.exit(0);
")
curl -s --max-time 8 -H "Cookie: xj_monitor_sid=$SID" https://monitor.xuanjian.top/api/auth/me
echo
node -e "
const Database=require('better-sqlite3');
const db=new Database('$APP/server/data/monitor.db');
db.prepare(\"DELETE FROM sessions WHERE ua='verify-name'\").run();
process.exit(0);
"
echo
echo "=== 5. 新构建资源 ==="
curl -s --max-time 8 https://monitor.xuanjian.top/ | grep -oE '/assets/index-[^"]+\.(js|css)' | head -2
