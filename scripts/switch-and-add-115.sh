#!/bin/bash
# 1) nginx 切到新面板(3004)  2) 接入 115 服务器  3) 验证
set -u
APP=/var/www/monitor-v2
cd "$APP/server"

echo "=== 1. 切换 nginx（3002 → 3004）==="
cp /etc/nginx/sites-enabled/monitor "/etc/nginx/sites-enabled/monitor.bak-$(date +%Y%m%d-%H%M%S)"
sed -i 's/proxy_pass http:\/\/127.0.0.1:3002/proxy_pass http:\/\/127.0.0.1:3004/' /etc/nginx/sites-enabled/monitor
grep -n 'proxy_pass' /etc/nginx/sites-enabled/monitor | head -2
nginx -t 2>&1 | tail -2
systemctl reload nginx
sleep 2
echo -n "  https://monitor.xuanjian.top/api/health -> "
curl -s --max-time 10 https://monitor.xuanjian.top/api/health | head -c 200
echo
echo -n "  首页 -> "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 https://monitor.xuanjian.top/

echo
echo "=== 2. 生成 115 专用安装令牌 ==="
TOKEN=$(node -e "
const crypto=require('crypto');
const Database=require('better-sqlite3');
const db=new Database('$APP/server/data/monitor.db');
const t=crypto.randomBytes(24).toString('hex');
db.prepare('INSERT INTO install_tokens (token_hash, expires_at, created_by, created_at) VALUES (?,?,?,?)').run(crypto.createHash('sha256').update(t).digest('hex'), Date.now()+30*60000, 'setup-115', Date.now());
console.log(t); process.exit(0);
")
echo "  令牌: ${TOKEN:0:8}…"

echo
echo "=== 3. 在 115 上安装 Agent ==="
ssh -o ConnectTimeout=8 -o StrictHostKeyChecking=no root@115.190.153.44 "curl -fsSL https://monitor.xuanjian.top/install/agent.sh -o /tmp/agent.sh && bash /tmp/agent.sh --master https://monitor.xuanjian.top --token $TOKEN" 2>&1 | tail -14

echo
echo "=== 4. 等待上报（20 秒）==="
sleep 20

echo "=== 5. 节点核对 ==="
node -e "
const Database=require('better-sqlite3');
const db=new Database('$APP/server/data/monitor.db');
const rows=db.prepare('SELECT id,hostname,label,status,os,agent_version,last_seen_at FROM servers').all();
rows.forEach((s)=>{
  const c=db.prepare('SELECT COUNT(*) c FROM metrics WHERE server_id=?').get(s.id).c;
  const m=db.prepare('SELECT cpu,mem_pct,disk_pct FROM metrics WHERE server_id=? ORDER BY id DESC LIMIT 1').get(s.id);
  console.log('  #'+s.id+' '+s.hostname+' ['+s.status+'] '+s.os+' 指标='+c+' 最新='+JSON.stringify(m||null));
});
process.exit(0);
"
