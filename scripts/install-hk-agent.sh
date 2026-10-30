#!/bin/bash
# 端到端验证：在 HK 本机安装 Agent，确认注册与上报成功
set -u
APP=/var/www/monitor-v2

cd "$APP/server" || exit 1
echo "=== 1. 生成安装令牌（30 分钟有效）==="
TOKEN=$(node -e "
const crypto=require('crypto');
const Database=require('better-sqlite3');
const db=new Database('$APP/server/data/monitor.db');
const t=crypto.randomBytes(24).toString('hex');
const h=crypto.createHash('sha256').update(t).digest('hex');
db.prepare('INSERT INTO install_tokens (token_hash, expires_at, created_by, created_at) VALUES (?,?,?,?)').run(h, Date.now()+30*60000, 'setup', Date.now());
console.log(t);
process.exit(0);
")
echo "  令牌前缀: ${TOKEN:0:8}…"

echo "=== 2. 在本机安装 Agent（master 用 127.0.0.1:3004）==="
bash "$APP/server/install/agent.sh" --master http://127.0.0.1:3004 --token "$TOKEN" --src "$APP/server/install/agent.js" 2>&1 | tail -12

echo
echo "=== 3. 等待首次上报 ==="
sleep 14

echo "=== 4. 数据库核对 ==="
node -e "
const Database=require('better-sqlite3');
const db=new Database('$APP/server/data/monitor.db');
const s=db.prepare('SELECT id,hostname,label,status,last_seen_at,agent_version FROM servers').all();
console.log('  节点: ' + JSON.stringify(s));
const m=db.prepare('SELECT server_id,ts,cpu,mem_pct,disk_pct,load1 FROM metrics ORDER BY id DESC LIMIT 3').all();
console.log('  最近指标: ' + JSON.stringify(m));
const count=db.prepare('SELECT COUNT(*) c FROM metrics').get().c;
console.log('  指标总数: ' + count);
process.exit(0);
" 2>&1

echo
echo "=== 5. Agent 日志 ==="
tail -6 /var/log/xuanjian-agent.log 2>/dev/null
