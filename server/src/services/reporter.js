/**
 * 定时报告：每日 / 每周发送集群健康报告
 * - 频率：report.frequency = daily | weekly，report.weekday（1=周一 … 7=周日），report.hour（0-23）
 * - 收件人：report.recipients（逗号分隔），留空回退 notify.emails
 * - 邮件为品牌化 HTML（内嵌 logo），同时提供纯文本版本
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const nodemailer = require('nodemailer');
const { db, getSetting, setSetting } = require('../db');

const WEB_DIR = path.join(__dirname, '..', '..', '..', 'web', 'dist');
const DAY_MS = 86400000;

function transport() {
    const host = getSetting('smtp.host');
    const port = Number(getSetting('smtp.port') || 465);
    const user = getSetting('smtp.user');
    const pass = getSetting('smtp.pass');
    if (!host || !user || !pass) return null;
    return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
}

function recipients() {
    const raw = String(getSetting('report.recipients') || getSetting('notify.emails') || '').trim();
    return raw
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter((s) => /^[^@\s]+@[^@\s]+$/.test(s));
}

function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function fmtBytes(mb) {
    const n = Number(mb) || 0;
    if (n >= 1024) return (n / 1024).toFixed(1) + ' GB';
    return Math.round(n) + ' MB';
}

/* ---------------- 数据汇总 ---------------- */

function collectSummary(days = 1) {
    const since = Date.now() - days * DAY_MS;
    const servers = db.prepare('SELECT * FROM servers ORDER BY id').all();
    const items = servers.map((s) => {
        const latest = db.prepare('SELECT * FROM metrics WHERE server_id = ? ORDER BY id DESC LIMIT 1').get(s.id);
        const agg = db
            .prepare(
                `SELECT AVG(cpu) cpuAvg, MAX(cpu) cpuMax, AVG(mem_pct) memAvg, MAX(mem_pct) memMax,
                        MAX(disk_pct) diskMax, AVG(load1) loadAvg, COUNT(*) n
                 FROM metrics WHERE server_id = ? AND ts >= ?`
            )
            .get(s.id, since);
        let raw = null;
        try {
            raw = latest && latest.raw ? JSON.parse(latest.raw) : null;
        } catch {
            raw = null;
        }
        const failedUnits = (raw && raw.systemd && Array.isArray(raw.systemd.failed) ? raw.systemd.failed : []).slice(0, 3);
        const rootDisk = (raw && raw.disks ? raw.disks.find((d) => d.mount === '/') || raw.disks[0] : null) || null;
        return {
            id: s.id,
            name: s.label || s.hostname,
            hostname: s.hostname,
            os: s.os,
            status: s.status,
            lastSeenAt: s.last_seen_at,
            cpu: latest ? latest.cpu : null,
            mem: latest ? latest.mem_pct : null,
            memUsed: latest ? latest.mem_used_mb : null,
            memTotal: latest ? latest.mem_total_mb : null,
            disk: latest ? latest.disk_pct : null,
            diskUsed: rootDisk ? rootDisk.usedMb : null,
            diskTotal: rootDisk ? rootDisk.totalMb : null,
            load1: latest ? latest.load1 : null,
            cores: raw && raw.cpu ? raw.cpu.cores : null,
            pm2: raw && raw.pm2 ? raw.pm2.length : 0,
            failedUnits,
            cpuAvg: agg.cpuAvg ? Number(agg.cpuAvg.toFixed(1)) : null,
            cpuMax: agg.cpuMax ? Number(agg.cpuMax.toFixed(1)) : null,
            memAvg: agg.memAvg ? Number(agg.memAvg.toFixed(1)) : null,
            memMax: agg.memMax ? Number(agg.memMax.toFixed(1)) : null,
            diskMax: agg.diskMax ? Number(agg.diskMax.toFixed(1)) : null,
            samples: agg.n || 0
        };
    });
    const alerts = db.prepare("SELECT * FROM alerts WHERE status = 'open' ORDER BY level DESC, id DESC").all();
    const resolved = db.prepare("SELECT COUNT(*) c FROM alerts WHERE status = 'resolved' AND resolved_at >= ?").get(since).c;
    return { days, servers: items, alerts, resolved };
}

/* ---------------- 邮件模板 ---------------- */

function barColor(pct) {
    if (pct >= 90) return '#d9384b';
    if (pct >= 80) return '#e8971f';
    if (pct >= 60) return '#2f7ce0';
    return '#12a06b';
}

function miniBar(label, pct, text) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    const color = barColor(p);
    return `<tr>
      <td style="padding:3px 0;width:44px;font-size:11px;color:#7c8aa5">${label}</td>
      <td style="padding:3px 8px 3px 0">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#eef2f9;border-radius:3px;height:6px">
          <tr><td style="width:${p}%;background:${color};border-radius:3px;height:6px;font-size:0;line-height:0">&nbsp;</td><td style="font-size:0;line-height:0">&nbsp;</td></tr>
        </table>
      </td>
      <td style="padding:3px 0;width:112px;font-size:11px;color:#3d4a63;text-align:right;white-space:nowrap">${escapeHtml(text)}</td>
    </tr>`;
}

function nodeCard(s) {
    const online = s.status === 'online';
    const badge = online
        ? '<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:#e6f8f0;color:#0f8f60;font-size:10px">在线</span>'
        : '<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:#fdecee;color:#c02b3c;font-size:10px">离线</span>';
    const worst = Math.max(Number(s.cpu) || 0, Number(s.mem) || 0, Number(s.disk) || 0);
    const accent = barColor(worst);
    const failed =
        s.failedUnits && s.failedUnits.length
            ? `<div style="margin-top:8px;font-size:11px;color:#c02b3c">⚠ 失败服务：${escapeHtml(s.failedUnits.join('、'))}</div>`
            : '';
    return `<td width="50%" valign="top" style="padding:6px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="background:#ffffff;border:1px solid #e6ecf7;border-left:3px solid ${accent};border-radius:10px">
        <tr><td style="padding:14px 16px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:14px;font-weight:700;color:#16233a">${escapeHtml(s.name)}</td>
              <td align="right">${badge}</td>
            </tr>
            <tr><td colspan="2" style="font-size:10.5px;color:#8a97ad;padding-top:2px">${escapeHtml(s.os || '')}${s.cores ? ' · ' + s.cores + ' 核' : ''} · PM2 ${s.pm2} 个</td></tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px">
            ${miniBar('CPU', s.cpu, `${s.cpu != null ? Number(s.cpu).toFixed(0) : '—'}%`)}
            ${miniBar('内存', s.mem, s.memUsed != null ? `${fmtBytes(s.memUsed)} / ${fmtBytes(s.memTotal)}` : '—')}
            ${miniBar('磁盘', s.disk, s.diskUsed != null ? `${fmtBytes(s.diskUsed)} / ${fmtBytes(s.diskTotal)}` : '—')}
          </table>
          <div style="margin-top:8px;font-size:10.5px;color:#7c8aa5">
            近${s.days || 1 === 1 ? '24 小时' : '7 天'}均值：CPU ${s.cpuAvg ?? '—'}% · 内存 ${s.memAvg ?? '—'}%
            &nbsp;|&nbsp; 峰值：CPU ${s.cpuMax ?? '—'}% · 内存 ${s.memMax ?? '—'}%
          </div>
          ${failed}
        </td></tr>
      </table>
    </td>`;
}

function renderHtml(sum, { weekly }) {
    const online = sum.servers.filter((s) => s.status === 'online').length;
    const total = sum.servers.length;
    const warn = sum.alerts.filter((a) => a.level === 'warn').length;
    const err = sum.alerts.length - warn;
    const period = weekly ? '周报（近 7 天）' : '日报（近 24 小时）';
    const title = weekly ? '北域工作室 · 服务器周报' : '北域工作室 · 服务器日报';
    const dateStr = new Date().toLocaleString('zh-CN', { hour12: false });

    const cards = [];
    for (let i = 0; i < sum.servers.length; i += 2) {
        const pair = sum.servers.slice(i, i + 2).map(nodeCard).join('');
        cards.push(`<tr>${pair}${sum.servers.length % 2 === 1 && i + 1 === sum.servers.length - 1 ? '<td width="50%" style="padding:6px"></td>' : ''}</tr>`);
    }

    const alertBlock = sum.alerts.length
        ? sum.alerts
              .slice(0, 12)
              .map((a) => {
                  const color = a.level === 'error' ? '#c02b3c' : '#b9740a';
                  const bg = a.level === 'error' ? '#fdecee' : '#fff6e6';
                  return `<tr>
                    <td style="padding:8px 12px;border-bottom:1px solid #f0f4fb">
                      <span style="display:inline-block;padding:1px 7px;border-radius:8px;background:${bg};color:${color};font-size:10px">${a.level === 'error' ? '严重' : '警告'}</span>
                    </td>
                    <td style="padding:8px 12px;border-bottom:1px solid #f0f4fb;font-size:11.5px;color:#2b3a55">${escapeHtml(a.message)}</td>
                  </tr>`;
              })
              .join('')
        : '<tr><td colspan="2" style="padding:16px;text-align:center;font-size:12px;color:#8a97ad">当前没有未处理告警 🎉</td></tr>';

    return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;padding:0;background:#eef2f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif">
<div style="display:none;font-size:0;line-height:0;max-height:0;overflow:hidden">${period} · ${online}/${total} 在线 · ${sum.alerts.length} 条告警</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f9;padding:24px 12px">
  <tr><td align="center">
    <table role="presentation" width="680" cellpadding="0" cellspacing="0" style="max-width:680px;width:100%;background:#f7f9fd;border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(22,35,58,.08)">
      <!-- 头部 -->
      <tr><td style="background:linear-gradient(135deg,#1b45b8,#3d6ff0);padding:22px 26px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <div style="font-size:17px;font-weight:700;color:#ffffff;letter-spacing:.5px">${title}</div>
              <div style="font-size:11px;color:#c9d8ff;margin-top:3px">${period} · ${dateStr}</div>
            </td>
            <td align="right">
              <div style="font-size:11px;color:#c9d8ff">NORTHLAND STUDIO</div>
              <div style="font-size:11px;color:#ffffff;margin-top:2px">monitor.xuanjian.top</div>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- 概览 -->
      <tr><td style="padding:18px 20px 6px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            ${[
                ['在线节点', `${online}/${total}`, online === total ? '#12a06b' : '#e8971f'],
                ['严重告警', String(err), err ? '#c02b3c' : '#12a06b'],
                ['警告', String(warn), warn ? '#b9740a' : '#12a06b'],
                ['已自动恢复', String(sum.resolved), '#2f7ce0']
            ]
                .map(
                    ([label, value, color]) => `<td width="25%" style="padding:0 5px">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e6ecf7;border-radius:10px">
                <tr><td style="padding:12px 14px">
                  <div style="font-size:21px;font-weight:700;color:${color};line-height:1.1">${value}</div>
                  <div style="font-size:10.5px;color:#8a97ad;margin-top:3px">${label}</div>
                </td></tr>
              </table>
            </td>`
                )
                .join('')}
          </tr>
        </table>
      </td></tr>

      <!-- 节点卡片 -->
      <tr><td style="padding:12px 14px 4px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cards.join('')}</table>
      </td></tr>

      <!-- 告警 -->
      <tr><td style="padding:8px 20px 4px">
        <div style="font-size:12.5px;font-weight:700;color:#16233a;margin:6px 0 8px">
          <span style="display:inline-block;width:3px;height:12px;background:#1b45b8;border-radius:2px;vertical-align:-1px;margin-right:7px"></span>未处理告警（${sum.alerts.length}）
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e6ecf7;border-radius:10px;overflow:hidden">${alertBlock}</table>
      </td></tr>

      <!-- 页脚 -->
      <tr><td style="padding:16px 26px 22px">
        <div style="font-size:10.5px;color:#95a2b8;line-height:1.7;border-top:1px solid #e6ecf7;padding-top:12px">
          本邮件由北域工作室服务器监控面板自动发送，可在「设置 → 定时日报」修改频率、时间与收件人。<br>
          查看详情：<a href="https://monitor.xuanjian.top" style="color:#1b45b8;text-decoration:none">https://monitor.xuanjian.top</a>
        </div>
      </td></tr>
    </table>
    <div style="font-size:10px;color:#a9b4c6;margin-top:14px">北域工作室 · Northland Studio</div>
  </td></tr>
</table>
</body></html>`;
}

function renderText(sum, { weekly }) {
    const period = weekly ? '近 7 天' : '近 24 小时';
    const lines = [`北域工作室 · 服务器${weekly ? '周报' : '日报'}（${period}）`, new Date().toLocaleString('zh-CN'), ''];
    for (const s of sum.servers) {
        lines.push(
            `${s.name} [${s.status === 'online' ? '在线' : '离线'}] CPU ${s.cpu ?? '—'}% 内存 ${s.mem ?? '—'}% 磁盘 ${s.disk ?? '—'}%` +
                ` | ${period}均值 CPU ${s.cpuAvg ?? '—'}% 内存 ${s.memAvg ?? '—'}%`
        );
        if (s.failedUnits && s.failedUnits.length) lines.push(`  失败服务：${s.failedUnits.join('、')}`);
    }
    lines.push('', `未处理告警 ${sum.alerts.length} 条：`);
    if (!sum.alerts.length) lines.push('  无');
    for (const a of sum.alerts.slice(0, 12)) lines.push(`  [${a.level === 'error' ? '严重' : '警告'}] ${a.message}`);
    lines.push('', '查看详情：https://monitor.xuanjian.top');
    return lines.join('\n');
}

/* ---------------- 发送 ---------------- */

function reportLogoAttachment() {
    const logo = path.join(WEB_DIR, 'logo-white-bg.png');
    try {
        const buf = fs.readFileSync(logo);
        return { filename: 'logo.png', content: buf, cid: 'northlandlogo', disposition: 'inline' };
    } catch {
        return null;
    }
}

async function sendReport({ force = false } = {}) {
    const enabled = String(getSetting('report.enabled') || '1') === '1';
    if (!enabled && !force) return { ok: false, error: '报告未启用' };

    const to = recipients();
    if (!to.length) return { ok: false, error: '未配置收件人（设置 → 定时日报）' };

    const weekly = String(getSetting('report.frequency') || 'daily') === 'weekly';
    const sum = collectSummary(weekly ? 7 : 1);
    const tx = transport();
    if (!tx) {
        console.log('[report] SMTP 未配置，报告跳过');
        return { ok: false, error: 'SMTP 未配置' };
    }

    const att = reportLogoAttachment();
    const online = sum.servers.filter((s) => s.status === 'online').length;
    const tag = weekly ? '周报' : '日报';
    try {
        const info = await tx.sendMail({
            from: `"北域监控" <${getSetting('smtp.user')}>`,
            to: to.join(','),
            subject: `【北域工作台】服务器${tag} · ${new Date().toLocaleDateString('zh-CN')}（${online}/${sum.servers.length} 在线，${sum.alerts.length} 条告警）`,
            text: renderText(sum, { weekly }),
            html: renderHtml(sum, { weekly }),
            attachments: att ? [att] : []
        });
        setSetting('report.lastSentDate', new Date().toISOString().slice(0, 10));
        setSetting('report.lastSentAt', Date.now());
        console.log(`[report] ${tag}已发送：${to.join(',')}（${info.messageId || 'ok'}）`);
        return { ok: true, to: to.join(','), frequency: weekly ? 'weekly' : 'daily', weekly };
    } catch (e) {
        console.error('[report] 发送失败：', e.message);
        return { ok: false, error: e.message };
    }
}

/** 每分钟检查：到点且该周期未发送则发送 */
async function tick() {
    const enabled = String(getSetting('report.enabled') || '1') === '1';
    if (!enabled) return;
    const hour = Number(getSetting('report.hour') || 9);
    const now = new Date();
    if (now.getHours() !== hour) return;

    const weekly = String(getSetting('report.frequency') || 'daily') === 'weekly';
    if (weekly) {
        const weekday = Number(getSetting('report.weekday') || 1); // 1=周一
        const iso = now.getDay() === 0 ? 7 : now.getDay();
        if (iso !== weekday) return;
        // 本周是否已发送
        const weekKey = `${now.getFullYear()}-W${String(Math.ceil((((now - new Date(now.getFullYear(), 0, 1)) / DAY_MS) + new Date(now.getFullYear(), 0, 1).getDay() + 1) / 7)).padStart(2, '0')}`;
        if (getSetting('report.lastSentWeek') === weekKey) return;
        const r = await sendReport();
        if (r.ok) setSetting('report.lastSentWeek', weekKey);
        return;
    }

    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const sentDate = getSetting('report.lastSentDate') || '';
    if (sentDate.slice(0, 10) === today) return;
    await sendReport();
}

module.exports = { sendReport, tick, collectSummary, renderHtml, recipients };
