#!/bin/bash
# 验证：只读动作自动执行（日志列表/尾部）、破坏性动作需审批、PWA
set -u
BASE=https://monitor.xuanjian.top
APP=/var/www/monitor-v2/server
cd "$APP"

SID=$(node -e "
const crypto=require('crypto');
const Database=require('better-sqlite3');
const db=new Database('$APP/data/monitor.db');
const sid=crypto.randomBytes(24).toString('hex');
db.prepare('INSERT INTO sessions (id,email,level,ip,ua,created_at,expires_at) VALUES (?,?,?,?,?,?,?)').run(sid,'northland@xuanjian.top',2,'127.0.0.1','verify3',Date.now(),Date.now()+3600000);
console.log(sid); process.exit(0);
")
C="Cookie: xj_monitor_sid=$SID"

echo "=== 1. 日志列表（只读 → 自动执行）==="
AID=$(curl -s --max-time 10 -X POST -H "$C" -H 'Content-Type: application/json' \
  --data-binary '{"serverId":2,"type":"log.list","params":{}}' "$BASE/api/actions" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.id+'|'+j.status)});")
echo "  动作: $AID"

echo "  等待 Agent 执行（最多 20 秒）…"
for i in $(seq 1 20); do
  sleep 1
  ST=$(curl -s --max-time 8 -H "$C" "$BASE/api/actions/${AID%%|*}" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.action?j.action.status:'?')});")
  [ "$ST" = "done" ] && break
  [ "$ST" = "failed" ] && break
done
echo "  最终状态: $ST"
curl -s --max-time 8 -H "$C" "$BASE/api/actions/${AID%%|*}" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const j=JSON.parse(s).action;
  if(!j){console.log('  无返回');return;}
  try{
    const list=JSON.parse(j.output||'[]');
    console.log('  返回日志文件数: '+list.length);
    list.slice(0,5).forEach(f=>console.log('    '+f.path+' ('+Math.round(f.size/1024)+'KB) ['+f.group+']'));
  }catch(e){ console.log('  输出: '+String(j.output||j.error).slice(0,150)); }
});"

echo
echo "=== 2. 日志尾部读取（只读 → 自动执行）==="
AID2=$(curl -s --max-time 10 -X POST -H "$C" -H 'Content-Type: application/json' \
  --data-binary '{"serverId":2,"type":"log.tail","params":{"path":"/var/log/syslog","lines":20}}' "$BASE/api/actions" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.id)});")
for i in $(seq 1 20); do
  sleep 1
  ST2=$(curl -s --max-time 8 -H "$C" "$BASE/api/actions/$AID2" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.action?j.action.status:'?')});")
  [ "$ST2" = "done" ] && break
done
echo "  状态: $ST2"
curl -s --max-time 8 -H "$C" "$BASE/api/actions/$AID2" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const j=JSON.parse(s).action;
  const out=String((j&&j.output)||'');
  console.log('  输出行数: '+out.split('\n').length);
  console.log('  最后一行: '+out.trim().split('\n').pop());
});"

echo
echo "=== 3. 破坏性动作需审批（fail2ban.ban → pending）==="
curl -s --max-time 10 -X POST -H "$C" -H 'Content-Type: application/json' \
  --data-binary '{"serverId":3,"type":"fail2ban.ban","params":{"jail":"sshd","ip":"203.0.113.9"},"reason":"verify"}' \
  "$BASE/api/actions" | head -c 160
echo

echo
echo "=== 4. 清理验证会话与测试动作 ==="
node -e "
const Database=require('better-sqlite3');
const db=new Database('$APP/data/monitor.db');
db.prepare(\"DELETE FROM sessions WHERE ua='verify3'\").run();
db.prepare(\"DELETE FROM actions WHERE reason='verify'\").run();
console.log('  已清理');
process.exit(0);
"
