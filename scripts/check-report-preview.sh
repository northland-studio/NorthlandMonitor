#!/bin/bash
# 生成报告 HTML 预览并检查新模板
set -u
APP=/var/www/monitor-v2/server
cd "$APP"

SID=$(node -e "
const crypto=require('crypto');
const Database=require('better-sqlite3');
const db=new Database('$APP/data/monitor.db');
const sid=crypto.randomBytes(24).toString('hex');
db.prepare('INSERT INTO sessions (id,email,level,ip,ua,created_at,expires_at) VALUES (?,?,?,?,?,?,?)').run(
  sid,'northland@xuanjian.top',2,'127.0.0.1','rpv',Date.now(),Date.now()+900000
);
console.log(sid);
process.exit(0);
")

echo "=== 预览 HTML ==="
curl -s --max-time 15 -H "Cookie: xj_monitor_sid=$SID" https://monitor.xuanjian.top/api/report/preview-html -o /var/www/monitor-v2/server/data/report-preview.html
echo "  大小: $(wc -c < data/report-preview.html) 字节"
grep -o '<title>[^<]*</title>' data/report-preview.html
echo -n "  包含节点卡片: "; grep -c 'border-left:3px solid' data/report-preview.html
echo -n "  包含进度条: "; grep -c 'background:#eef2f9;border-radius:3px;height:6px' data/report-preview.html
echo -n "  包含告警区: "; grep -c '未处理告警' data/report-preview.html

echo
echo "=== 周报预览（临时切 weekly）==="
node -e "
const Database=require('better-sqlite3');
const db=new Database('$APP/data/monitor.db');
db.prepare(\"UPDATE settings SET value='weekly' WHERE key='report.frequency'\").run();
process.exit(0);
"
curl -s --max-time 15 -H "Cookie: xj_monitor_sid=$SID" https://monitor.xuanjian.top/api/report/preview-html -o data/report-preview-weekly.html
echo "  大小: $(wc -c < data/report-preview-weekly.html) 字节"
grep -o '服务器周报' data/report-preview-weekly.html | head -1
node -e "
const Database=require('better-sqlite3');
const db=new Database('$APP/data/monitor.db');
db.prepare(\"UPDATE settings SET value='daily' WHERE key='report.frequency'\").run();
db.prepare(\"DELETE FROM sessions WHERE ua='rpv'\").run();
process.exit(0);
"

echo
echo "=== 当前报告配置 ==="
node -e "
const Database=require('better-sqlite3');
const db=new Database('$APP/data/monitor.db');
db.prepare(\"SELECT key,value FROM settings WHERE key LIKE 'report.%' ORDER BY key\").all().forEach(r=>console.log('  '+r.key+' = '+r.value));
process.exit(0);
"
