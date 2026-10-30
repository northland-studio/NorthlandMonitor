#!/bin/bash
# 最终状态核对
set -u
APP=/var/www/monitor-v2/server
cd "$APP"

echo "=== 健康检查 ==="
curl -s --max-time 8 https://monitor.xuanjian.top/api/health
echo
echo
echo "=== 节点 ==="
node /root/summary.cjs 2>&1
echo
echo "=== 旧版入口 ==="
echo -n "  /legacy/ -> "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 8 https://monitor.xuanjian.top/legacy/
echo -n "  /legacy/api/system -> "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 8 https://monitor.xuanjian.top/legacy/api/system
echo
echo "=== PWA ==="
for p in /manifest.webmanifest /sw.js; do
  echo -n "  $p -> "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 8 "https://monitor.xuanjian.top$p"
done
echo
echo "=== 进程 ==="
pm2 list 2>/dev/null | grep -E 'monitor' | head -3
echo
echo "=== 日报配置 ==="
node -e "
const Database=require('better-sqlite3');
const db=new Database('$APP/data/monitor.db');
db.prepare(\"SELECT key,value FROM settings WHERE key LIKE 'report.%'\").all().forEach(r=>console.log('  '+r.key+' = '+r.value));
console.log('  动作总数: '+db.prepare('SELECT COUNT(*) c FROM actions').get().c);
process.exit(0);
"
