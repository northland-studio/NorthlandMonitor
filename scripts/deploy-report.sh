#!/bin/bash
# 部署：报告重构（频率/收件人/新模板）+ 前端设置页
set -euo pipefail
APP=/var/www/monitor-v2
SRC=/root/report-stage

rm -rf "$SRC" && mkdir -p "$SRC"
tar -xzf /root/report-build.tar.gz -C "$SRC"

echo "=== 1. 同步 ==="
rsync -a --delete "$SRC/web/dist/" "$APP/web/dist/"
rsync -a "$SRC/server/src/" "$APP/server/src/"
node --check "$APP/server/src/services/reporter.js" && node --check "$APP/server/src/routes/api.js" && echo "  语法 OK"

echo "=== 2. 收件人默认只给站长 ==="
cd "$APP/server"
node -e "
const Database=require('better-sqlite3');
const db=new Database('$APP/server/data/monitor.db');
const put=db.prepare('INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at');
put.run('report.recipients','northland@xuanjian.top',Date.now());
put.run('report.frequency','daily',Date.now());
put.run('report.hour','9',Date.now());
put.run('report.weekday','1',Date.now());
put.run('report.enabled','1',Date.now());
db.prepare(\"SELECT key,value FROM settings WHERE key LIKE 'report.%'\").all().forEach(r=>console.log('  '+r.key+' = '+r.value));
process.exit(0);
"

echo "=== 3. 重启 ==="
pm2 restart monitor-v2 --update-env >/dev/null
sleep 5
curl -s --max-time 8 https://monitor.xuanjian.top/api/health | head -c 120
echo

echo "=== 4. 生成邮件 HTML 预览（保存到 /tmp 便于检查）==="
SID=$(node -e "
const crypto=require('crypto');
const Database=require('better-sqlite3');
const db=new Database('$APP/server/data/monitor.db');
const sid=crypto.randomBytes(24).toString('hex');
db.prepare('INSERT INTO sessions (id,email,level,ip,ua,created_at,expires_at) VALUES (?,?,?,?,?,?,?)').run(sid,'northland@xuanjian.top',2,'127.0.0.1','report-verify',Date.now(),Date.now()+900000);
console.log(sid); process.exit(0);
")
curl -s --max-time 15 -H "Cookie: xj_monitor_sid=$SID" https://monitor.xuanjian.top/api/report/preview-html -o /tmp/report-preview.html
echo "  大小: $(wc -c < /tmp/report-preview.html) 字节"
grep -o '<title>[^<]*</title>' /tmp/report-preview.html
node -e "
const Database=require('better-sqlite3');
const db=new Database('$APP/server/data/monitor.db');
db.prepare(\"DELETE FROM sessions WHERE ua='report-verify'\").run();
process.exit(0);
"

echo "=== 5. 真实发送一封 ==="
SID2=$(node -e "
const crypto=require('crypto');
const Database=require('better-sqlite3');
const db=new Database('$APP/server/data/monitor.db');
const sid=crypto.randomBytes(24).toString('hex');
db.prepare('INSERT INTO sessions (id,email,level,ip,ua,created_at,expires_at) VALUES (?,?,?,?,?,?,?)').run(sid,'northland@xuanjian.top',2,'127.0.0.1','report-verify2',Date.now(),Date.now()+900000);
console.log(sid); process.exit(0);
")
curl -s --max-time 40 -X POST -H "Cookie: xj_monitor_sid=$SID2" -H 'Content-Type: application/json' \
  --data-binary '{}' https://monitor.xuanjian.top/api/report/send | head -c 220
echo
node -e "
const Database=require('better-sqlite3');
const db=new Database('$APP/server/data/monitor.db');
db.prepare(\"DELETE FROM sessions WHERE ua='report-verify2'\").run();
process.exit(0);
"
echo
echo "=== 6. 邮件日志 ==="
pm2 logs monitor-v2 --lines 20 --nostream 2>/dev/null | grep -a 'report' | tail -3
