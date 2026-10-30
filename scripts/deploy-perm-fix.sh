#!/bin/bash
# 修复：权限实时生效（旧会话 level=1 也能立即编辑设置）
set -euo pipefail
APP=/var/www/monitor-v2
SRC=/root/perm-stage

rm -rf "$SRC" && mkdir -p "$SRC"
tar -xzf /root/perm-fix.tar.gz -C "$SRC"

echo "=== 1. 同步 ==="
rsync -a --delete "$SRC/web/dist/" "$APP/web/dist/"
rsync -a "$SRC/server/src/" "$APP/server/src/"
node --check "$APP/server/src/auth.js" && node --check "$APP/server/src/routes/api.js" && echo "  语法 OK"

echo "=== 2. 重启 ==="
pm2 restart monitor-v2 --update-env >/dev/null
sleep 5
curl -s --max-time 8 https://monitor.xuanjian.top/api/health | head -c 120
echo

echo "=== 3. 验证：用 level=1 的旧会话访问管理接口 ==="
cd "$APP/server"
SID=$(node -e "
const crypto=require('crypto');
const Database=require('better-sqlite3');
const db=new Database('$APP/server/data/monitor.db');
const sid=crypto.randomBytes(24).toString('hex');
// 故意写入 level=1（模拟提升前的旧会话）
db.prepare('INSERT INTO sessions (id,email,level,ip,ua,created_at,expires_at) VALUES (?,?,?,?,?,?,?)').run(sid,'morzane_work@foxmail.com',1,'127.0.0.1','perm-verify',Date.now(),Date.now()+1800000);
console.log(sid); process.exit(0);
")
C="Cookie: xj_monitor_sid=$SID"
echo -n "  /api/auth/me -> "
curl -s --max-time 8 -H "$C" https://monitor.xuanjian.top/api/auth/me
echo
echo -n "  PUT /api/settings（应为 200，实时读到 level=2）-> "
curl -s -o /tmp/set.json -w '%{http_code}' --max-time 10 -X PUT -H "$C" -H 'Content-Type: application/json' \
  --data-binary '{"settings":{"report.enabled":"1","report.hour":"9"}}' https://monitor.xuanjian.top/api/settings
echo " $(cat /tmp/set.json | head -c 120)"
echo -n "  读取日报配置 -> "
curl -s --max-time 8 -H "$C" https://monitor.xuanjian.top/api/settings | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const st=j.settings||{};console.log('report.enabled='+st['report.enabled']+' report.hour='+st['report.hour']);});"
node -e "
const Database=require('better-sqlite3');
const db=new Database('$APP/server/data/monitor.db');
db.prepare(\"DELETE FROM sessions WHERE ua='perm-verify'\").run();
process.exit(0);
"
