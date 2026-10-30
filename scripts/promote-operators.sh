#!/bin/bash
# 1) 全部运维设为管理员  2) 验证码邮件带姓名
set -u
APP=/var/www/monitor-v2/server
cd "$APP"

echo "=== 1. 全部提升为管理员 ==="
node -e "
const Database=require('better-sqlite3');
const db=new Database('$APP/data/monitor.db');
const before=db.prepare('SELECT level,COUNT(*) c FROM operators GROUP BY level').all();
console.log('  调整前: '+JSON.stringify(before));
db.prepare('UPDATE operators SET level=2').run();
const rows=db.prepare('SELECT id,email,name,level FROM operators ORDER BY id').all();
rows.forEach(o=>console.log('  #'+o.id+' '+(o.name||'-')+' <'+o.email+'> 管理员'));
console.log('  共 '+rows.length+' 人，全部为管理员');
process.exit(0);
"
