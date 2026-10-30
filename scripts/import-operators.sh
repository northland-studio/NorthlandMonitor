#!/bin/bash
# 导入旧 monitor 的运维名单到新库
set -u
APP=/var/www/monitor-v2/server
OLD=/var/www/monitor/operators.json

echo "=== 1. 旧名单 ==="
if [ ! -f "$OLD" ]; then
  echo "  找不到 $OLD"
  exit 1
fi
cd "$APP"
node -e "
const fs=require('fs');
const list=JSON.parse(fs.readFileSync('$OLD','utf8'));
console.log('  旧名单共 '+list.length+' 条：');
list.forEach((o,i)=>console.log('   '+(i+1)+'. '+o.name+' <'+o.email+'>'));
process.exit(0);
"

echo
echo "=== 2. 写入新库（已存在则跳过；全部赋予只读权限，northland 保持管理员）==="
node -e "
const fs=require('fs');
const Database=require('better-sqlite3');
const db=new Database('$APP/data/monitor.db');
const list=JSON.parse(fs.readFileSync('$OLD','utf8'));
const insert=db.prepare('INSERT OR IGNORE INTO operators (email, name, level, active, created_at) VALUES (?, ?, 1, 1, ?)');
let added=0;
for (const o of list) {
  const email=String(o.email||'').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) { console.log('   跳过无效邮箱: '+(o.email||'')); continue; }
  const r=insert.run(email, String(o.name||''), Date.now());
  if (r.changes) added++;
}
// 已存在的旧名单邮箱统一为只读（不动 northland 管理员）
const onlyRead=db.prepare(\"UPDATE operators SET level=1 WHERE email <> 'northland@xuanjian.top' AND level <> 1\");
onlyRead.run();
console.log('  新增 '+added+' 条');
process.exit(0);
"

echo
echo "=== 3. 当前运维名单 ==="
node -e "
const Database=require('better-sqlite3');
const db=new Database('$APP/data/monitor.db');
const rows=db.prepare('SELECT id,email,name,level,active FROM operators ORDER BY level DESC, id').all();
rows.forEach(o=>console.log('  #'+o.id+' '+(o.name||'-')+' <'+o.email+'> '+(o.level>=2?'管理员':'只读')));
console.log('  共 '+rows.length+' 人');
process.exit(0);
"
