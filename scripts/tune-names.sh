#!/bin/bash
# 微调：侧栏宽度与用户卡片 + 管理员显示名
set -u
APP=/var/www/monitor-v2/server
cd "$APP"

echo "=== 1. 管理员显示名优化 ==="
node -e "
const Database=require('better-sqlite3');
const db=new Database('$APP/data/monitor.db');
db.prepare(\"UPDATE operators SET name='站长' WHERE email='northland@xuanjian.top'\").run();
db.prepare(\"UPDATE operators SET name='玄剑公会' WHERE email='xuanjian_guild@xuanjian.top'\").run();
db.prepare('SELECT email,name FROM operators ORDER BY id').all().forEach(o=>console.log('  '+(o.name||'-')+' <'+o.email+'>'));
process.exit(0);
"
