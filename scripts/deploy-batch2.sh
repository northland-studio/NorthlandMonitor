#!/bin/bash
# 部署第二批改进：前端(指标格式/重命名) + Agent(pm2 PATH) + 三节点命名
set -euo pipefail
APP=/var/www/monitor-v2
SRC=/root/northland-stage2

rm -rf "$SRC" && mkdir -p "$SRC"
tar -xzf /root/northland-build2.tar.gz -C "$SRC"

echo "=== 1. 前端 ==="
rsync -a --delete "$SRC/web/dist/" "$APP/web/dist/"
echo "  $(find "$APP/web/dist" -type f | wc -l) 个文件"

echo "=== 2. 服务端/Agent 源 ==="
rsync -a "$SRC/server/src/" "$APP/server/src/"
cp "$SRC/server/install/agent.js" "$APP/server/install/agent.js"
node --check "$APP/server/install/agent.js"

echo "=== 3. 更新三台 Agent（pm2 PATH 修复）==="
cp "$APP/server/install/agent.js" /opt/xuanjian-agent/agent.js
systemctl restart xuanjian-agent
scp -q "$APP/server/install/agent.js" root@115.190.153.44:/opt/xuanjian-agent/agent.js && \
  ssh -o ConnectTimeout=8 root@115.190.153.44 'systemctl restart xuanjian-agent' && echo "  115 已更新"

echo "=== 4. 给节点命名 ==="
cd "$APP/server"
node -e "
const Database=require('better-sqlite3');
const db=new Database('$APP/server/data/monitor.db');
const map={2:'HK 主控（官网）',3:'115 Web 服务器',4:'群机器人服务器'};
for (const [id,label] of Object.entries(map)) db.prepare('UPDATE servers SET label=? WHERE id=?').run(label, Number(id));
db.prepare(\"SELECT id,label,hostname FROM servers ORDER BY id\").all().forEach(s=>console.log('  #'+s.id+' '+s.label+' ('+s.hostname+')'));
process.exit(0);
"

echo "=== 5. 重启主控 ==="
pm2 restart monitor-v2 --update-env >/dev/null
sleep 6
curl -s --max-time 8 https://monitor.xuanjian.top/api/health
echo

echo "=== 6. 等待上报核对 PM2 ==="
sleep 20
node /root/status.cjs 2>&1 | head -8
