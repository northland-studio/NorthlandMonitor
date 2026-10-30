#!/bin/bash
# 重置 HK Agent 并重新安装（agent 修复后验证）
set -u
APP=/var/www/monitor-v2
cd /root
rm -rf /root/monitor-v2-stage
mkdir -p /root/monitor-v2-stage
tar -xzf /root/monitor-v2-src.tar.gz -C /root/monitor-v2-stage

# 同步代码 + 前端
rsync -a /root/monitor-v2-stage/server/src/ "$APP/server/src/"
rsync -a /root/monitor-v2-stage/server/install/ "$APP/server/install/"
cp /root/monitor-v2-stage/server/package.json "$APP/server/package.json"
mkdir -p "$APP/web"
rsync -a /root/monitor-v2-stage/web/dist/ "$APP/web/dist/"
chmod +x "$APP/server/install/agent.sh"

echo "=== 1. 清理旧凭证与旧节点 ==="
systemctl stop xuanjian-agent 2>/dev/null || true
systemctl disable xuanjian-agent 2>/dev/null || true
rm -f /etc/xuanjian-agent/state.json /etc/xuanjian-agent/config.json /var/log/xuanjian-agent.log
cd "$APP/server"
node -e "
const Database=require('better-sqlite3');
const db=new Database('$APP/server/data/monitor.db');
db.prepare('DELETE FROM metrics').run();
db.prepare('DELETE FROM alerts').run();
db.prepare('DELETE FROM actions').run();
db.prepare('DELETE FROM servers').run();
db.prepare('DELETE FROM install_tokens').run();
console.log('  已清空节点/指标/令牌');
process.exit(0);
"

echo "=== 2. 生成新令牌并安装 ==="
TOKEN=$(node -e "
const crypto=require('crypto');
const Database=require('better-sqlite3');
const db=new Database('$APP/server/data/monitor.db');
const t=crypto.randomBytes(24).toString('hex');
db.prepare('INSERT INTO install_tokens (token_hash, expires_at, created_by, created_at) VALUES (?,?,?,?)').run(crypto.createHash('sha256').update(t).digest('hex'), Date.now()+30*60000, 'setup', Date.now());
console.log(t); process.exit(0);
")
bash "$APP/server/install/agent.sh" --master http://127.0.0.1:3004 --token "$TOKEN" --src "$APP/server/install/agent.js" 2>&1 | tail -6

echo
echo "=== 3. 等待两次上报（25 秒）==="
sleep 25

echo "=== 4. 核对 ==="
node -e "
const Database=require('better-sqlite3');
const db=new Database('$APP/server/data/monitor.db');
console.log('  节点: ' + JSON.stringify(db.prepare('SELECT id,hostname,status,agent_version FROM servers').all()));
console.log('  指标数: ' + db.prepare('SELECT COUNT(*) c FROM metrics').get().c);
const m=db.prepare('SELECT cpu,mem_pct,disk_pct,load1,net_rx_rate FROM metrics ORDER BY id DESC LIMIT 2').all();
console.log('  最近: ' + JSON.stringify(m));
process.exit(0);
"
echo "=== 5. Agent 日志（应为单行不重复）==="
tail -5 /var/log/xuanjian-agent.log
echo "=== 6. 服务状态 ==="
systemctl is-active xuanjian-agent
