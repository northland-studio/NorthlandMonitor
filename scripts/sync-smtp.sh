#!/bin/bash
# 同步 SMTP/告警配置到 DB + 查看当前告警 + 测试邮件通道
set -u
APP=/var/www/monitor-v2/server
cd "$APP"

node -e "
require('dotenv').config({ path: '/var/www/monitor-v2/server/.env' });
const Database=require('better-sqlite3');
const db=new Database('/var/www/monitor-v2/server/data/monitor.db');
const put=db.prepare('INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at');
const map={
  'smtp.host': process.env.SMTP_HOST||'smtp.exmail.qq.com',
  'smtp.port': process.env.SMTP_PORT||'465',
  'smtp.user': process.env.SMTP_USER||'',
  'smtp.pass': process.env.SMTP_PASS||'',
  'notify.emails': process.env.NOTIFY_EMAILS||process.env.SMTP_USER||''
};
for (const [k,v] of Object.entries(map)) put.run(k,String(v),Date.now());
console.log('  已同步配置: ' + Object.keys(map).join(', '));
console.log('  smtp.user=' + map['smtp.user'] + ' 密码长度=' + String(map['smtp.pass']).length);

console.log('\n=== 当前未处理告警 ===');
const rows=db.prepare(\"SELECT server_id,rule,level,message FROM alerts WHERE status='open'\").all();
rows.forEach(r=>console.log('  ['+r.level+'] '+r.message));
if(!rows.length) console.log('  无');

console.log('\n=== 清理测试会话 ===');
db.prepare(\"DELETE FROM sessions WHERE ua='verify'\").run();
process.exit(0);
"

echo
echo "=== 测试邮件发送（真发一封）==="
curl -s --max-time 30 -X POST https://monitor.xuanjian.top/api/auth/send-code -H 'Content-Type: application/json' \
  --data-binary '{"email":"northland@xuanjian.top"}' | head -c 300
echo
echo
echo "=== 服务端日志里的验证码（若是 fallback 会打印）==="
pm2 logs monitor-v2 --lines 30 --nostream 2>/dev/null | grep -a -E '验证码|发送验证码失败' | tail -3
