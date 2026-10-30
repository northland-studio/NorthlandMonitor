/**
 * 面板 API：节点 / 指标 / 动作 / 告警 / 令牌 / 运维 / 审计 / 配置
 */
'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { db, getSetting, getSettings, setSetting } = require('../db');
const { requireAuth, requireAdmin, sendLoginCode, verifyLoginCode, setSessionCookie, clearSessionCookie, sessionFromReq, sha256 } = require('../auth');
const alerter = require('../services/alerter');
const reporter = require('../services/reporter');

const router = express.Router();

function audit(req, action, target, detail) {
    db.prepare('INSERT INTO audit (actor, action, target, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        req.session ? req.session.email : 'anonymous',
        action,
        target || '',
        detail ? JSON.stringify(detail).slice(0, 2000) : '',
        req.ip || '',
        Date.now()
    );
}

/* ---------------- 认证 ---------------- */

router.post('/auth/send-code', async (req, res) => {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ ok: false, error: '请输入邮箱' });
    const r = await sendLoginCode(email);
    res.status(r.ok ? 200 : 400).json(r);
});

router.post('/auth/login', (req, res) => {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const code = String((req.body && req.body.code) || '').trim();
    const r = verifyLoginCode(email, code);
    if (!r.ok) return res.status(400).json(r);
    setSessionCookie(res, r.sid);
    db.prepare('INSERT INTO audit (actor, action, target, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        email,
        'auth.login',
        '',
        '',
        req.ip || '',
        Date.now()
    );
    const op = db.prepare('SELECT name FROM operators WHERE email = ?').get(r.email);
    res.json({ ok: true, email: r.email, level: r.level, name: (op && op.name) || r.email.split('@')[0] });
});

router.get('/auth/me', (req, res) => {
    const s = sessionFromReq(req);
    if (!s) return res.status(401).json({ ok: false, error: '未登录' });
    res.json({ ok: true, email: s.email, level: s.level, name: s.name || s.email.split('@')[0] });
});

router.post('/auth/logout', (req, res) => {
    const s = sessionFromReq(req);
    if (s) db.prepare('DELETE FROM sessions WHERE id = ?').run(s.id);
    clearSessionCookie(res);
    res.json({ ok: true });
});

/* ---------------- 节点 ---------------- */

router.get('/servers', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT * FROM servers ORDER BY id').all();
    const out = rows.map((s) => {
        const m = db.prepare('SELECT * FROM metrics WHERE server_id = ? ORDER BY ts DESC LIMIT 1').get(s.id);
        const openAlerts = db.prepare("SELECT COUNT(*) c FROM alerts WHERE server_id = ? AND status = 'open'").get(s.id).c;
        let raw = null;
        try {
            raw = m && m.raw ? JSON.parse(m.raw) : null;
        } catch {
            raw = null;
        }
        return {
            id: s.id,
            hostname: s.hostname,
            label: s.label,
            os: s.os,
            arch: s.arch,
            status: s.status,
            lastSeenAt: s.last_seen_at,
            agentVersion: s.agent_version,
            openAlerts,
            latest: m
                ? {
                      ts: m.ts,
                      cpu: m.cpu,
                      memPct: m.mem_pct,
                      memUsedMb: m.mem_used_mb,
                      memTotalMb: m.mem_total_mb,
                      load1: m.load1,
                      diskPct: m.disk_pct,
                      netRxRate: m.net_rx_rate,
                      netTxRate: m.net_tx_rate,
                      uptimeSec: m.uptime_sec,
                      cores: raw && raw.cpu ? raw.cpu.cores : null,
                      disks: raw ? raw.disks : [],
                      pm2: raw ? raw.pm2 : [],
                      systemd: raw ? raw.systemd : null,
                      fail2ban: raw ? raw.fail2ban : null
                  }
                : null
        };
    });
    res.json({ ok: true, servers: out });
});

router.get('/servers/:id/metrics', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 24 * 30);
    const since = Date.now() - hours * 3600 * 1000;
    const rows = db
        .prepare('SELECT ts, cpu, mem_pct, load1, disk_pct, net_rx_rate, net_tx_rate FROM metrics WHERE server_id = ? AND ts >= ? ORDER BY ts')
        .all(id, since);
    // 抽样到最多 500 个点
    const step = Math.max(1, Math.floor(rows.length / 500));
    const sampled = rows.filter((_, i) => i % step === 0);
    res.json({ ok: true, points: sampled, total: rows.length });
});

router.get('/servers/:id/detail', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const s = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
    if (!s) return res.status(404).json({ ok: false, error: '节点不存在' });
    const m = db.prepare('SELECT * FROM metrics WHERE server_id = ? ORDER BY ts DESC LIMIT 1').get(id);
    let raw = null;
    try {
        raw = m && m.raw ? JSON.parse(m.raw) : null;
    } catch {
        raw = null;
    }
    res.json({ ok: true, server: s, metrics: raw });
});

router.patch('/servers/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const { label, note } = req.body || {};
    db.prepare('UPDATE servers SET label = COALESCE(?, label), note = COALESCE(?, note) WHERE id = ?').run(label ?? null, note ?? null, id);
    audit(req, 'server.update', String(id), { label, note });
    res.json({ ok: true });
});

router.delete('/servers/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM metrics WHERE server_id = ?').run(id);
    db.prepare('DELETE FROM actions WHERE server_id = ?').run(id);
    db.prepare('DELETE FROM alerts WHERE server_id = ?').run(id);
    db.prepare('DELETE FROM servers WHERE id = ?').run(id);
    audit(req, 'server.delete', String(id), {});
    res.json({ ok: true });
});

/* ---------------- 安装令牌（一键接入） ---------------- */

router.post('/install-tokens', requireAuth, (req, res) => {
    const ttlMinutes = Math.min(Math.max(Number((req.body && req.body.ttlMinutes) || 10), 1), 120);
    const token = crypto.randomBytes(24).toString('hex');
    const info = db
        .prepare('INSERT INTO install_tokens (token_hash, expires_at, created_by, created_at) VALUES (?, ?, ?, ?)')
        .run(sha256(token), Date.now() + ttlMinutes * 60000, req.session.email, Date.now());
    audit(req, 'token.create', String(info.lastInsertRowid), { ttlMinutes });
    const master = (req.body && req.body.master) || (req.protocol + '://' + req.get('host'));
    res.json({
        ok: true,
        token,
        expiresAt: Date.now() + ttlMinutes * 60000,
        command: `curl -fsSL ${master.replace(/\/+$/, '')}/install/agent.sh | sudo bash -s -- --master ${master.replace(/\/+$/, '')} --token ${token}`
    });
});

router.get('/install-tokens', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT id, expires_at, used_at, used_server_id, created_by, created_at FROM install_tokens ORDER BY id DESC LIMIT 20').all();
    res.json({ ok: true, tokens: rows });
});

/* ---------------- 动作（白名单 + 审批） ---------------- */

router.get('/actions', requireAuth, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = db.prepare('SELECT * FROM actions ORDER BY id DESC LIMIT ?').all(limit);
    res.json({ ok: true, actions: rows });
});

router.get('/actions/:id', requireAuth, (req, res) => {
    const row = db.prepare('SELECT * FROM actions WHERE id = ?').get(Number(req.params.id));
    if (!row) return res.status(404).json({ ok: false, error: '动作不存在' });
    res.json({ ok: true, action: row });
});

/** 只读动作：不需要审批，提交即生效（仍全量审计） */
const READONLY_ACTIONS = new Set(['log.tail', 'log.list', 'system.info', 'file.list', 'file.read', 'file.download']);

router.post('/actions', requireAuth, (req, res) => {
    const { serverId, type, params, reason } = req.body || {};
    if (!serverId || !type) return res.status(400).json({ ok: false, error: '缺少 serverId 或 type' });
    const s = db.prepare('SELECT * FROM servers WHERE id = ?').get(Number(serverId));
    if (!s) return res.status(404).json({ ok: false, error: '节点不存在' });
    const auto = READONLY_ACTIONS.has(String(type));
    const info = db
        .prepare(
            `INSERT INTO actions (server_id, type, params, status, reason, requested_by, created_at, approved_by, approved_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
            Number(serverId),
            String(type),
            JSON.stringify(params || {}),
            auto ? 'approved' : 'pending',
            String(reason || ''),
            req.session.email,
            Date.now(),
            auto ? 'system:auto' : null,
            auto ? Date.now() : null
        );
    audit(req, auto ? 'action.auto' : 'action.request', `${serverId}/${type}`, params);
    res.json({ ok: true, id: info.lastInsertRowid, status: auto ? 'approved' : 'pending', auto });
});

router.post('/actions/:id/approve', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const a = db.prepare('SELECT * FROM actions WHERE id = ?').get(id);
    if (!a) return res.status(404).json({ ok: false, error: '动作不存在' });
    if (a.status !== 'pending') return res.status(400).json({ ok: false, error: '该动作当前状态不可审批：' + a.status });
    // 审批人不能是申请人（双人闭环），若只有一人运维则允许自我审批并在审计里标注
    const operatorCount = db.prepare('SELECT COUNT(*) c FROM operators WHERE active = 1').get().c;
    if (operatorCount > 1 && a.requested_by === req.session.email) {
        return res.status(403).json({ ok: false, error: '申请人不能审批自己的动作（请由其他运维审批）' });
    }
    db.prepare("UPDATE actions SET status = 'approved', approved_by = ?, approved_at = ? WHERE id = ?").run(req.session.email, Date.now(), id);
    audit(req, 'action.approve', `${a.server_id}/${a.type}`, { id, selfApproved: a.requested_by === req.session.email });
    res.json({ ok: true, id, status: 'approved' });
});

router.post('/actions/:id/reject', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const a = db.prepare('SELECT * FROM actions WHERE id = ?').get(id);
    if (!a) return res.status(404).json({ ok: false, error: '动作不存在' });
    db.prepare("UPDATE actions SET status = 'rejected', approved_by = ?, approved_at = ? WHERE id = ?").run(req.session.email, Date.now(), id);
    audit(req, 'action.reject', `${a.server_id}/${a.type}`, { id });
    res.json({ ok: true });
});

/* ---------------- 告警 ---------------- */

router.get('/alerts', requireAuth, (req, res) => {
    const status = String(req.query.status || 'open');
    const limit = Math.min(Number(req.query.limit) || 100, 300);
    const rows =
        status === 'all'
            ? db.prepare('SELECT * FROM alerts ORDER BY id DESC LIMIT ?').all(limit)
            : db.prepare('SELECT * FROM alerts WHERE status = ? ORDER BY id DESC LIMIT ?').all(status, limit);
    const servers = db.prepare('SELECT id, hostname, label FROM servers').all();
    const map = Object.fromEntries(servers.map((s) => [s.id, s]));
    res.json({ ok: true, alerts: rows.map((a) => ({ ...a, server: map[a.server_id] || null })) });
});

router.post('/alerts/:id/resolve', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    db.prepare("UPDATE alerts SET status = 'resolved', resolved_at = ? WHERE id = ?").run(Date.now(), id);
    audit(req, 'alert.resolve', String(id), {});
    res.json({ ok: true });
});

/* ---------------- 运维人员 ---------------- */

router.get('/operators', requireAuth, (req, res) => {
    res.json({ ok: true, operators: db.prepare('SELECT id, email, name, level, active, created_at FROM operators ORDER BY id').all() });
});

router.post('/operators', requireAdmin, (req, res) => {
    const { email, name, level } = req.body || {};
    const mail = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(mail)) return res.status(400).json({ ok: false, error: '邮箱格式不正确' });
    try {
        const info = db
            .prepare('INSERT INTO operators (email, name, level, active, created_at) VALUES (?, ?, ?, 1, ?)')
            .run(mail, String(name || ''), Math.min(Math.max(Number(level) || 1, 1), 2), Date.now());
        audit(req, 'operator.create', mail, {});
        res.json({ ok: true, id: info.lastInsertRowid });
    } catch (e) {
        res.status(400).json({ ok: false, error: '该邮箱已存在' });
    }
});

router.delete('/operators/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM operators WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ ok: false, error: '不存在' });
    const count = db.prepare('SELECT COUNT(*) c FROM operators WHERE active = 1').get().c;
    if (count <= 1) return res.status(400).json({ ok: false, error: '至少保留一名运维' });
    db.prepare('DELETE FROM operators WHERE id = ?').run(id);
    audit(req, 'operator.delete', row.email, {});
    res.json({ ok: true });
});

/* ---------------- 审计与配置 ---------------- */

router.get('/audit', requireAuth, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    res.json({ ok: true, audit: db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(limit) });
});

router.get('/settings', requireAuth, (req, res) => {
    const all = getSettings();
    // 脱敏
    if (all['smtp.pass']) all['smtp.pass'] = '******';
    res.json({ ok: true, settings: all });
});

router.put('/settings', requireAdmin, (req, res) => {
    const patch = (req.body && req.body.settings) || {};
    const written = [];
    for (const [k, v] of Object.entries(patch)) {
        if (k === 'smtp.pass' && String(v) === '******') continue;
        if (!/^(alert|metric|smtp|notify|report)\./.test(k)) continue;
        setSetting(k, v);
        written.push(k);
    }
    audit(req, 'settings.update', '', { keys: written });
    res.json({ ok: true, written });
});

/* ---------------- 定时日报 ---------------- */

router.get('/report/preview', requireAuth, (req, res) => {
    res.json({ ok: true, ...reporter.collectSummary() });
});

router.get('/report/preview-html', requireAuth, (req, res) => {
    const weekly = String(getSetting('report.frequency') || 'daily') === 'weekly';
    const sum = reporter.collectSummary(weekly ? 7 : 1);
    res.type('html').send(reporter.renderHtml(sum, { weekly }));
});

router.post('/report/send', requireAdmin, async (req, res) => {
    const r = await reporter.sendReport({ force: true });
    audit(req, 'report.send', '', r);
    res.status(r.ok ? 200 : 500).json(r);
});

router.get('/stats', requireAuth, (req, res) => {
    const servers = db.prepare('SELECT COUNT(*) c FROM servers').get().c;
    const online = db.prepare("SELECT COUNT(*) c FROM servers WHERE status = 'online'").get().c;
    const openAlerts = db.prepare("SELECT COUNT(*) c FROM alerts WHERE status = 'open'").get().c;
    const pendingActions = db.prepare("SELECT COUNT(*) c FROM actions WHERE status = 'pending'").get().c;
    const metricsCount = db.prepare('SELECT COUNT(*) c FROM metrics').get().c;
    res.json({ ok: true, servers, online, openAlerts, pendingActions, metricsCount });
});

module.exports = router;
