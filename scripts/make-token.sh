#!/bin/bash
# 生成一个安装令牌用于机器人服务器接入
cd /var/www/monitor-v2/server || exit 1
node -e "
const crypto=require('crypto');
const Database=require('better-sqlite3');
const db=new Database('/var/www/monitor-v2/server/data/monitor.db');
const t=crypto.randomBytes(24).toString('hex');
db.prepare('INSERT INTO install_tokens (token_hash, expires_at, created_by, created_at) VALUES (?,?,?,?)').run(
  crypto.createHash('sha256').update(t).digest('hex'),
  Date.now()+60*60000,
  'setup-bot',
  Date.now()
);
console.log(t);
process.exit(0);
"
