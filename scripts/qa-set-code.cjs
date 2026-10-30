/** QA：把登录验证码重置为固定值 123456（仅用于可视化验收，10 分钟后自动失效） */
const crypto = require('node:crypto');
const Database = require('/var/www/monitor-v2/server/node_modules/better-sqlite3');
const db = new Database('/var/www/monitor-v2/server/data/monitor.db');

const email = 'northland@xuanjian.top';
const hash = crypto.createHash('sha256').update('123456').digest('hex');
db.prepare('UPDATE login_codes SET code_hash = ?, attempts = 0, expires_at = ? WHERE email = ?').run(hash, Date.now() + 10 * 60000, email);
const row = db.prepare('SELECT email, attempts, expires_at FROM login_codes WHERE email = ?').get(email);
console.log(row ? '  验证码已重置为 123456：' + JSON.stringify(row) : '  没有待验证记录');
process.exit(0);
