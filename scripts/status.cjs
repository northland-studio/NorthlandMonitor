/** 打印节点 + 未处理告警（在 HK 上运行） */
const Database = require('/var/www/monitor-v2/server/node_modules/better-sqlite3');
const db = new Database('/var/www/monitor-v2/server/data/monitor.db');

const rows = db.prepare('SELECT id, hostname, status FROM servers ORDER BY id').all();
for (const s of rows) {
    const count = db.prepare('SELECT COUNT(*) c FROM metrics WHERE server_id = ?').get(s.id).c;
    const m = db.prepare('SELECT cpu, mem_pct, disk_pct FROM metrics WHERE server_id = ? ORDER BY id DESC LIMIT 1').get(s.id);
    console.log(`  节点 #${s.id} ${s.hostname} [${s.status}] 指标=${count} 最新=${m ? JSON.stringify(m) : 'null'}`);
}

const alerts = db.prepare("SELECT server_id, rule, level, message FROM alerts WHERE status = 'open'").all();
console.log(`\n  未处理告警 ${alerts.length} 条:`);
for (const a of alerts) console.log(`    [${a.level}] ${a.message}`);
process.exit(0);
