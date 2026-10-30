#!/bin/bash
# 验证：登录邮件通道 + 会话鉴权 + 三个核心 API
set -u
BASE=https://monitor.xuanjian.top
APP=/var/www/monitor-v2/server
cd "$APP"

echo "=== 1. 发送验证码（测试邮件通道）==="
curl -s --max-time 25 -X POST "$BASE/api/auth/send-code" -H 'Content-Type: application/json' \
  --data-binary '{"email":"northland@xuanjian.top"}' | head -c 300
echo

echo
echo "=== 2. 直接创建测试会话（跳过邮箱，验证鉴权链路）==="
SID=$(node -e "
const crypto=require('crypto');
const Database=require('better-sqlite3');
const db=new Database('/var/www/monitor-v2/server/data/monitor.db');
const sid=crypto.randomBytes(24).toString('hex');
db.prepare('INSERT INTO sessions (id,email,level,ip,ua,created_at,expires_at) VALUES (?,?,?,?,?,?,?)').run(sid,'northland@xuanjian.top',2,'127.0.0.1','verify',Date.now(),Date.now()+3600000);
console.log(sid); process.exit(0);
")
echo "  会话: ${SID:0:10}…"

echo
echo "=== 3. 鉴权 API 验证 ==="
for p in /api/stats /api/servers /api/alerts /api/actions /api/audit; do
  code=$(curl -s -o /tmp/api.out -w '%{http_code}' --max-time 10 -H "Cookie: xj_monitor_sid=$SID" "$BASE$p")
  size=$(wc -c < /tmp/api.out)
  echo "  $p -> HTTP $code (${size}B)"
done

echo
echo "=== 4. /api/servers 内容摘要 ==="
curl -s --max-time 10 -H "Cookie: xj_monitor_sid=$SID" "$BASE/api/servers" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const j=JSON.parse(s);
  (j.servers||[]).forEach(v=>console.log('  #'+v.id+' '+(v.label||v.hostname)+' ['+v.status+'] cpu='+(v.latest?v.latest.cpu:'-')+' mem='+(v.latest?v.latest.memPct:'-')+'% disk='+(v.latest?v.latest.diskPct:'-')+'% pm2='+((v.latest&&v.latest.pm2)||[]).length+' 告警='+v.openAlerts));
})"

echo
echo "=== 5. 指标趋势接口（HK 节点 1 小时）==="
curl -s --max-time 10 -H "Cookie: xj_monitor_sid=$SID" "$BASE/api/servers/2/metrics?hours=1" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('  点数: '+(j.points||[]).length+' / 总 '+j.total);})"

echo
echo "=== 6. 安装令牌接口 ==="
curl -s --max-time 10 -X POST -H "Cookie: xj_monitor_sid=$SID" -H 'Content-Type: application/json' \
  --data-binary "{\"ttlMinutes\":10,\"master\":\"https://monitor.xuanjian.top\"}" "$BASE/api/install-tokens" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('  命令: '+String(j.command||j.error).slice(0,120));})"
