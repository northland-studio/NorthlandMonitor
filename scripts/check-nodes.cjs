/** 打印所有节点与其最新指标（在 HK 上运行） */
const Database = require('/var/www/monitor-v2/server/node_modules/better-sqlite3');
const db = new Database('/var/www/monitor-v2/server/data/monitor.db');

const rows = db.prepare('SELECT id, hostname, label, status, os, agent_version, last_seen_at FROM servers ORDER BY id').all();
if (!rows.length) console.log('  （暂无节点）');
for (const s of rows) {
    const count = db.prepare('SELECT COUNT(*) c FROM metrics WHERE server_id = ?').get(s.id).c;
    const m = db.prepare('SELECT cpu, mem_pct, disk_pct, load1 FROM metrics WHERE server_id = ? ORDER BY id DESC LIMIT 1').get(s.id);
    console.log(
        `  #${s.id} ${s.hostname} [${s.status}] ${s.os || ''} 指标=${count} 最新=${m ? JSON.stringify(m) : 'null'}`
    );
}
const alerts = db.prepare("SELECT COUNT(*) c FROM alerts WHERE status = 'open'").get().c;
console.log(`  未处理告警: ${alerts}`);
process.exit(0);
