/** 读取统计与节点概要（在 HK 上运行） */
const Database = require('/var/www/monitor-v2/server/node_modules/better-sqlite3');
const db = new Database('/var/www/monitor-v2/server/data/monitor.db');

const servers = db.prepare('SELECT COUNT(*) c FROM servers').get().c;
const online = db.prepare("SELECT COUNT(*) c FROM servers WHERE status = 'online'").get().c;
const metrics = db.prepare('SELECT COUNT(*) c FROM metrics').get().c;
const alerts = db.prepare("SELECT COUNT(*) c FROM alerts WHERE status = 'open'").get().c;
console.log(`  节点 ${online}/${servers} 在线 · 指标点 ${metrics} · 未处理告警 ${alerts}`);

for (const s of db.prepare('SELECT id,label,hostname FROM servers ORDER BY id').all()) {
    const m = db.prepare('SELECT cpu,mem_pct,disk_pct,raw FROM metrics WHERE server_id = ? ORDER BY id DESC LIMIT 1').get(s.id);
    let pm2 = 0;
    try {
        pm2 = (JSON.parse(m.raw).pm2 || []).length;
    } catch {
        pm2 = 0;
    }
    console.log(`  #${s.id} ${s.label} CPU=${m.cpu}% 内存=${m.mem_pct}% 磁盘=${m.disk_pct}% PM2=${pm2}`);
}
process.exit(0);
