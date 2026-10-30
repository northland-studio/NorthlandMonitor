/**
 * 定时报告：每天固定时间把集群概览 + 未处理告警汇总发邮件
 */
'use strict';

const nodemailer = require('nodemailer');
const { db, getSetting, setSetting } = require('../db');

function transport() {
    const host = getSetting('smtp.host');
    const port = Number(getSetting('smtp.port') || 465);
    const user = getSetting('smtp.user');
    const pass = getSetting('smtp.pass');
    if (!host || !user || !pass) return null;
    return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
}

function collectSummary() {
    const servers = db.prepare('SELECT * FROM servers ORDER BY id').all();
    const lines = [];
    for (const s of servers) {
        const m = db.prepare('SELECT * FROM metrics WHERE server_id = ? ORDER BY id DESC LIMIT 1').get(s.id);
        const day = db
            .prepare('SELECT AVG(cpu) cpu, MAX(cpu) maxCpu, AVG(mem_pct) mem, MAX(disk_pct) disk, COUNT(*) n FROM metrics WHERE server_id = ? AND ts >= ?')
            .get(s.id, Date.now() - 86400000);
        lines.push({
            id: s.id,
            name: s.label || s.hostname,
            status: s.status,
            latest: m,
            avgCpu: day.cpu ? Number(day.cpu.toFixed(1)) : null,
            maxCpu: day.maxCpu ? Number(day.maxCpu.toFixed(1)) : null,
            avgMem: day.mem ? Number(day.mem.toFixed(1)) : null,
            maxDisk: day.disk ? Number(day.disk.toFixed(1)) : null,
            samples: day.n || 0
        });
    }
    const alerts = db.prepare("SELECT * FROM alerts WHERE status = 'open' ORDER BY id DESC").all();
    const resolved24h = db.prepare("SELECT COUNT(*) c FROM alerts WHERE status = 'resolved' AND resolved_at >= ?").get(Date.now() - 86400000).c;
    return { servers: lines, alerts, resolved24h };
}

function renderHtml(sum) {
    const rows = sum.servers
        .map(
            (s) => `<tr>
        <td>${escapeHtml(s.name)}</td>
        <td>${s.status === 'online' ? '在线' : '离线'}</td>
        <td>${s.latest ? s.latest.cpu.toFixed(1) + '%' : '—'}</td>
        <td>${s.avgCpu ?? '—'}% / ${s.maxCpu ?? '—'}%</td>
        <td>${s.avgMem ?? '—'}%</td>
        <td>${s.maxDisk ?? '—'}%</td>
        <td>${s.samples}</td>
      </tr>`
        )
        .join('');
    const alertHtml = sum.alerts.length
        ? `<ul>${sum.alerts.map((a) => `<li><b>[${a.level}]</b> ${escapeHtml(a.message)}</li>`).join('')}</ul>`
        : '<p style="color:#666">当前没有未处理告警。</p>';
    return `<div style="font-family:sans-serif;line-height:1.7;color:#1a2438">
    <h2 style="margin:0 0 4px">北域工作室 · 服务器日报</h2>
    <p style="color:#666;margin:0 0 16px">${new Date().toLocaleString('zh-CN')} · 节点 ${sum.servers.filter((s) => s.status === 'online').length}/${sum.servers.length} 在线</p>
    <table cellpadding="8" cellspacing="0" style="border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#f2f5fb;text-align:left">
        <th>节点</th><th>状态</th><th>当前 CPU</th><th>24h 平均/峰值 CPU</th><th>24h 平均内存</th><th>最大磁盘</th><th>采样点</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <h3 style="margin:18px 0 6px">未处理告警（${sum.alerts.length}）</h3>
    ${alertHtml}
    <p style="color:#888;font-size:12px;margin-top:18px">过去 24 小时已自动恢复 ${sum.resolved24h} 条告警。<br>详情请登录 https://monitor.xuanjian.top</p>
  </div>`;
}

function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function sendReport({ force = false } = {}) {
    const enabled = String(getSetting('report.enabled') || '1') === '1';
    if (!enabled && !force) return { ok: false, error: '日报未启用' };

    const to = String(getSetting('notify.emails') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    if (!to.length) return { ok: false, error: '未配置收件人' };

    const tx = transport();
    const sum = collectSummary();
    const html = renderHtml(sum);
    if (!tx) {
        console.log('[report] SMTP 未配置，日报跳过');
        return { ok: false, error: 'SMTP 未配置' };
    }
    try {
        await tx.sendMail({
            from: `"北域监控" <${getSetting('smtp.user')}>`,
            to: to.join(','),
            subject: `【北域工作台】服务器日报 ${new Date().toLocaleDateString('zh-CN')}（${sum.servers.filter((s) => s.status === 'online').length}/${sum.servers.length} 在线，${sum.alerts.length} 条告警）`,
            text: `北域工作室服务器日报\n\n` +
                sum.servers.map((s) => `${s.name} [${s.status}] CPU ${s.latest ? s.latest.cpu + '%' : '—'} 内存 ${s.latest ? s.latest.mem_pct + '%' : '—'} 磁盘 ${s.latest ? s.latest.disk_pct + '%' : '—'}`).join('\n') +
                `\n\n未处理告警 ${sum.alerts.length} 条\n` +
                sum.alerts.map((a) => `[${a.level}] ${a.message}`).join('\n'),
            html
        });
        setSetting('report.lastSentDate', new Date().toISOString().slice(0, 10));
        setSetting('report.lastSentAt', Date.now());
        console.log('[report] 日报已发送：' + to.join(','));
        return { ok: true, to: to.join(',') };
    } catch (e) {
        console.error('[report] 日报发送失败：', e.message);
        return { ok: false, error: e.message };
    }
}

/** 每分钟检查一次，到点且今天未发则发送 */
async function tick() {
    const enabled = String(getSetting('report.enabled') || '1') === '1';
    if (!enabled) return;
    const hour = Number(getSetting('report.hour') || 9);
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (now.getHours() !== hour) return;
    if (getSetting('report.lastSentDate') === today) return;
    await sendReport();
}

module.exports = { sendReport, tick, collectSummary };
