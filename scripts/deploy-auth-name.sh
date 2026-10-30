#!/bin/bash
# 部署：验证码邮件带姓名 + 校验全部运维为管理员
set -euo pipefail
APP=/var/www/monitor-v2
SRC=/root/northland-stage5

rm -rf "$SRC" && mkdir -p "$SRC"
tar -xzf /root/northland-auth.tar.gz -C "$SRC"

echo "=== 1. 同步服务端 ==="
rsync -a "$SRC/server/src/" "$APP/server/src/"
node --check "$APP/server/src/auth.js" && echo "  语法 OK"
grep -n 'displayName' "$APP/server/src/auth.js" | head -3

echo "=== 2. 重启 ==="
pm2 restart monitor-v2 --update-env >/dev/null
sleep 5
curl -s --max-time 8 https://monitor.xuanjian.top/api/health
echo

echo "=== 3. 实际发送验证码（收件人：张津瑞）==="
curl -s --max-time 30 -X POST https://monitor.xuanjian.top/api/auth/send-code \
  -H 'Content-Type: application/json' \
  --data-binary '{"email":"morzane_work@foxmail.com"}' | head -c 200
echo

echo "=== 4. 再发一封（收件人：王子翰）==="
curl -s --max-time 30 -X POST https://monitor.xuanjian.top/api/auth/send-code \
  -H 'Content-Type: application/json' \
  --data-binary '{"email":"wzhuser2021@163.com"}' | head -c 200
echo

echo "=== 5. 运维权限核对 ==="
cd "$APP/server"
node -e "
const Database=require('better-sqlite3');
const db=new Database('$APP/server/data/monitor.db');
const rows=db.prepare('SELECT email,name,level FROM operators ORDER BY id').all();
rows.forEach(o=>console.log('  '+(o.level>=2?'管理员':'只读')+' · '+(o.name||'-')+' <'+o.email+'>'));
const allAdmin=rows.every(o=>o.level>=2);
console.log('  全部管理员: '+(allAdmin?'是':'否'));
process.exit(0);
"
