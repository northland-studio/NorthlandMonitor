/**
 * 告警引擎：阈值判定 + 冷却 + 邮件通知
 */
'use strict';

const nodemailer = require('nodemailer');
const { db, getSetting } = require('../db');

function notifyTransport() {
    const host = getSetting('smtp.host');
    const port = Number(getSetting('smtp.port') || 465);
    const user = getSetting('smtp.user');
    const pass = getSetting('smtp.pass');
    if (!host || !user || !pass) return null;
    return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
}

function openAlert(serverId, rule) {
    return db
        .prepare("SELECT * FROM alerts WHERE server_id = ? AND rule = ? AND status = 'open' ORDER BY id DESC LIMIT 1")
        .get(serverId, rule);
}

function alreadyAlertedRecently(serverId, rule) {
    const cooldown = Number(getSetting('alert.cooldownSeconds') || 600) * 1000;
    const row = db
        .prepare('SELECT created_at FROM alerts WHERE server_id = ? AND rule = ? ORDER BY id DESC LIMIT 1')
        .get(serverId, rule);
    return row && Date.now() - row.created_at < cooldown;
}

function raise({ serverId, rule, level = 'warn', message, value }) {
    const existing = openAlert(serverId, rule);
    if (existing) {
        db.prepare('UPDATE alerts SET message = ?, value = ? WHERE id = ?').run(message, String(value ?? ''), existing.id);
        return null;
    }
    const info = db
        .prepare('INSERT INTO alerts (server_id, rule, level, message, value, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(serverId, rule, level, message, String(value ?? ''), 'open', Date.now());
    return { id: info.lastInsertRowid, serverId, rule, level, message, value };
}

function resolve(serverId, rule) {
    db.prepare("UPDATE alerts SET status = 'resolved', resolved_at = ? WHERE server_id = ? AND rule = ? AND status = 'open'").run(
        Date.now(),
        serverId,
        rule
    );
}

async function notifyEmail(alerts) {
    if (!alerts.length) return;
    const to = String(getSetting('notify.emails') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    if (!to.length) return;
    const transport = notifyTransport();
    if (!transport) {
        console.log('[alert] SMTP 未配置，跳过邮件通知：' + alerts.map((a) => a.message).join('；'));
        return;
    }
    const body = alerts.map((a) => `- [${a.level}] ${a.message}（${a.rule}=${a.value}）`).join('\n');
    try {
        await transport.sendMail({
            from: `"北域监控" <${getSetting('smtp.user')}>`,
            to: to.join(','),
            subject: `【监控告警】${alerts.length} 条新告警`,
            text: `以下服务器触发告警：\n\n${body}\n\n请登录监控面板查看详情。`,
            html: `<div style="font-family:sans-serif;line-height:1.8">
                <p>以下服务器触发告警：</p>
                <ul>${alerts.map((a) => `<li><b>[${a.level}]</b> ${a.message}（${a.rule}=${a.value}）</li>`).join('')}</ul>
                <p style="color:#666">请登录监控面板查看详情。</p>
            </div>`
        });
        db.prepare(`UPDATE alerts SET notified = 1 WHERE id IN (${alerts.map(() => '?').join(',')})`).run(...alerts.map((a) => a.id));
    } catch (e) {
        console.error('[alert] 邮件通知失败：', e.message);
    }
}

/** 对一次上报做阈值检查 */
function evaluate(server, metrics) {
    const cpuLimit = Number(getSetting('alert.cpuPct') || 85);
    const memLimit = Number(getSetting('alert.memPct') || 90);
    const diskLimit = Number(getSetting('alert.diskPct') || 85);
    const loadPerCore = Number(getSetting('alert.loadPerCore') || 2.5);
    const label = server.label || server.hostname || 'server#' + server.id;
    const picked = [];

    const push = (rule, level, message, value) => {
        const existing = openAlert(server.id, rule);
        if (existing) {
            db.prepare('UPDATE alerts SET message = ?, value = ? WHERE id = ?').run(message, String(value ?? ''), existing.id);
            return;
        }
        if (alreadyAlertedRecently(server.id, rule)) return;
        const a = raise({ serverId: server.id, rule, level, message, value });
        if (a) picked.push(a);
    };

    if (metrics.cpu && metrics.cpu.usage >= cpuLimit) push('cpu.high', 'warn', `${label} CPU 使用率 ${metrics.cpu.usage}%（阈值 ${cpuLimit}%）`, metrics.cpu.usage);
    else resolve(server.id, 'cpu.high');

    if (metrics.mem && metrics.mem.pct >= memLimit) push('mem.high', 'warn', `${label} 内存使用率 ${metrics.mem.pct}%（阈值 ${memLimit}%）`, metrics.mem.pct);
    else resolve(server.id, 'mem.high');

    const rootDisk = (metrics.disks || []).find((d) => d.mount === '/') || (metrics.disks || [])[0];
    if (rootDisk && rootDisk.pct >= diskLimit)
        push('disk.high', 'warn', `${label} 磁盘 ${rootDisk.mount} 使用率 ${rootDisk.pct}%（阈值 ${diskLimit}%）`, rootDisk.pct);
    else resolve(server.id, 'disk.high');

    const cores = (metrics.cpu && metrics.cpu.cores) || 1;
    if (metrics.load && metrics.load.load1 / cores >= loadPerCore)
        push('load.high', 'warn', `${label} 负载 ${metrics.load.load1}（每核 ${(metrics.load.load1 / cores).toFixed(2)}）`, metrics.load.load1);
    else resolve(server.id, 'load.high');

    if (metrics.systemd && Array.isArray(metrics.systemd.failed) && metrics.systemd.failed.length)
        push(
            'service.failed',
            'error',
            `${label} 有 ${metrics.systemd.failed.length} 个 systemd 服务失败：${metrics.systemd.failed.slice(0, 3).join(', ')}`,
            metrics.systemd.failed.length
        );
    else resolve(server.id, 'service.failed');

    if (picked.length) notifyEmail(picked).catch(() => {});
    return picked;
}

/** 离线检测（由主控定时任务调用） */
async function checkOffline() {
    const limit = Number(getSetting('alert.offlineSeconds') || 90) * 1000;
    const servers = db.prepare("SELECT * FROM servers WHERE status = 'online'").all();
    const picked = [];
    for (const s of servers) {
        const last = s.last_seen_at || 0;
        if (Date.now() - last > limit) {
            db.prepare("UPDATE servers SET status = 'offline' WHERE id = ?").run(s.id);
            const a = raise({
                serverId: s.id,
                rule: 'server.offline',
                level: 'error',
                message: `${s.label || s.hostname} 已离线（最后心跳 ${Math.round((Date.now() - last) / 1000)} 秒前）`,
                value: Math.round((Date.now() - last) / 1000)
            });
            if (a) picked.push(a);
        }
    }
    if (picked.length) await notifyEmail(picked);
    return picked.length;
}

module.exports = { evaluate, checkOffline, notifyEmail, raise, resolve };
