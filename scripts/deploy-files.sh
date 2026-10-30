#!/bin/bash
# 部署文件管理（Agent 动作 + 前端页签）并验证
set -euo pipefail
APP=/var/www/monitor-v2
SRC=/root/northland-stage4

rm -rf "$SRC" && mkdir -p "$SRC"
tar -xzf /root/northland-build4.tar.gz -C "$SRC"

echo "=== 1. 前端 ==="
rsync -a --delete "$SRC/web/dist/" "$APP/web/dist/"

echo "=== 2. 服务端 ==="
rsync -a "$SRC/server/src/" "$APP/server/src/"
node --check "$APP/server/src/routes/api.js" && echo "  语法 OK"

echo "=== 3. Agent 升级（file.list / file.read / file.download）==="
cp "$SRC/server/install/agent.js" "$APP/server/install/agent.js"
cp "$APP/server/install/agent.js" /opt/xuanjian-agent/agent.js
systemctl restart xuanjian-agent
scp -q "$APP/server/install/agent.js" root@115.190.153.44:/opt/xuanjian-agent/agent.js && \
  ssh -o ConnectTimeout=8 root@115.190.153.44 'systemctl restart xuanjian-agent' && echo "  115 已升级"
echo "  HK 已升级"

echo "=== 4. 重启主控 ==="
pm2 restart monitor-v2 --update-env >/dev/null
sleep 6
curl -s --max-time 8 https://monitor.xuanjian.top/api/health
echo

echo "=== 5. 验证 file.list / file.read / file.download ==="
cd "$APP/server"
SID=$(node -e "
const crypto=require('crypto');
const Database=require('better-sqlite3');
const db=new Database('$APP/server/data/monitor.db');
const sid=crypto.randomBytes(24).toString('hex');
db.prepare('INSERT INTO sessions (id,email,level,ip,ua,created_at,expires_at) VALUES (?,?,?,?,?,?,?)').run(sid,'northland@xuanjian.top',2,'127.0.0.1','verify-file',Date.now(),Date.now()+1800000);
console.log(sid); process.exit(0);
")
C="Cookie: xj_monitor_sid=$SID"

run_action() {
  local type="$1" params="$2"
  local id
  id=$(curl -s --max-time 10 -X POST -H "$C" -H 'Content-Type: application/json' \
    --data-binary "{\"serverId\":2,\"type\":\"$type\",\"params\":$params}" https://monitor.xuanjian.top/api/actions \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.id)});")
  for i in $(seq 1 20); do
    sleep 1
    local st
    st=$(curl -s --max-time 8 -H "$C" "https://monitor.xuanjian.top/api/actions/$id" \
      | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.action?j.action.status:'?')});")
    if [ "$st" = "done" ] || [ "$st" = "failed" ]; then echo "$id"; return; fi
  done
  echo "$id"
}

echo "  --- file.list /var/www ---"
ID1=$(run_action file.list '{"path":"/var/www"}')
curl -s --max-time 8 -H "$C" "https://monitor.xuanjian.top/api/actions/$ID1" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const j=JSON.parse(s).action;
  try { const d=JSON.parse(j.output); console.log('    目录: '+d.path+'，条目 '+d.entries.length); d.entries.slice(0,5).forEach(e=>console.log('      '+(e.isDir?'[D] ':'[F] ')+e.name)); } catch(e){ console.log('    '+(j.output||j.error).slice(0,120)); }
});"

echo "  --- file.read /etc/nginx/nginx.conf ---"
ID2=$(run_action file.read '{"path":"/etc/nginx/nginx.conf"}')
curl -s --max-time 8 -H "$C" "https://monitor.xuanjian.top/api/actions/$ID2" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const j=JSON.parse(s).action;
  const out=String(j.output||j.error||'');
  console.log('    行数 '+out.split('\n').length+'，首行: '+out.split('\n')[0]);
});"

echo "  --- file.download（小文件）---"
ID3=$(run_action file.download '{"path":"/etc/nginx/nginx.conf"}')
curl -s --max-time 8 -H "$C" "https://monitor.xuanjian.top/api/actions/$ID3" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const j=JSON.parse(s).action;
  try { const d=JSON.parse(j.output); console.log('    文件 '+d.name+'，'+d.size+' B，base64 长度 '+d.base64.length); } catch(e){ console.log('    '+(j.output||j.error).slice(0,120)); }
});"

echo "  --- 越权校验（/etc/shadow 应被拒绝）---"
ID4=$(run_action file.read '{"path":"/etc/shadow"}')
curl -s --max-time 8 -H "$C" "https://monitor.xuanjian.top/api/actions/$ID4" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const j=JSON.parse(s).action;
  console.log('    状态='+j.status+' 输出: '+String(j.output||j.error||'').slice(0,80));
});"

node -e "
const Database=require('better-sqlite3');
const db=new Database('$APP/server/data/monitor.db');
db.prepare(\"DELETE FROM sessions WHERE ua='verify-file'\").run();
process.exit(0);
"
echo
echo "=== 完成 ==="
