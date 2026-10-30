/**
 * Agent 接入路由：注册 / 上报 / 动作结果
 * 认证：X-Agent-Token（安装时一次性 Token，注册后写回服务器专属 token）
 */
'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { db, getSetting } = require('../db');
const alerter = require('../services/alerter');
const { sha256 } = require('../auth');

const router = express.Router();

function bearer(req) {
    const t = req.headers['x-agent-token'] || req.query.token;
    return String(t || '');
}

function serverByToken(token) {
    if (!token) return null;
    return db.prepare('SELECT * FROM servers WHERE token_hash = ?').get(sha256(token));
}

/** 从上报内容里取根分区使用率 */
function rootDiskPct(metrics) {
    const list = (metrics && metrics.disks) || [];
    const root = list.find((d) => d.mount === '/') || list[0];
    return root ? Number(root.pct) : 0;
}

/* ---------------- 注册 ---------------- */

router.post('/register', (req, res) => {
    const token = bearer(req);
    if (!token) return res.status(401).json({ ok: false, error: '缺少 Token' });

    // 1) 优先当作安装令牌（一次性）
    const row = db.prepare('SELECT * FROM install_tokens WHERE token_hash = ?').get(sha256(token));
    const { hostname = '', os = '', arch = '', agentVersion = '' } = req.body || {};

    if (row) {
        if (row.used_at) return res.status(403).json({ ok: false, error: '安装令牌已被使用' });
        if (row.expires_at < Date.now()) return res.status(403).json({ ok: false, error: '安装令牌已过期' });

        // 生成服务器专属 token
        const serverToken = crypto.randomBytes(24).toString('hex');
        const info = db
            .prepare('INSERT INTO servers (hostname, label, os, arch, agent_version, token_hash, status, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(hostname, hostname, `${os} ${arch}`.trim(), arch, agentVersion, sha256(serverToken), 'online', Date.now(), Date.now());
        const serverId = info.lastInsertRowid;
        db.prepare('UPDATE install_tokens SET used_at = ?, used_server_id = ? WHERE id = ?').run(Date.now(), serverId, row.id);

        console.log(`[agent] 新节点注册 #${serverId} ${hostname}`);
        return res.json({
            ok: true,
            serverId,
            token: serverToken,
            intervalMs: Number(getSetting('metric.reportIntervalMs') || 10000)
        });
    }

    // 2) 已注册服务器重连
    const s = serverByToken(token);
    if (!s) return res.status(401).json({ ok: false, error: 'Token 无效' });
    db.prepare("UPDATE servers SET status = 'online', last_seen_at = ? WHERE id = ?").run(Date.now(), s.id);
    return res.json({ ok: true, serverId: s.id, token, intervalMs: Number(getSetting('metric.reportIntervalMs') || 10000) });
});

/* ---------------- 上报 ---------------- */

router.post('/report', (req, res) => {
    const s = serverByToken(bearer(req));
    if (!s) return res.status(401).json({ ok: false, error: 'Token 无效' });

    const { metrics } = req.body || {};
    if (!metrics || typeof metrics !== 'object') return res.status(400).json({ ok: false, error: '缺少 metrics' });

    const ts = Number(metrics.ts) || Date.now();
    const cpu = metrics.cpu || {};
    const mem = metrics.mem || {};
    const load = metrics.load || {};
    const net = metrics.net || {};

    db.prepare(
        `INSERT INTO metrics (server_id, ts, cpu, mem_pct, mem_used_mb, mem_total_mb, load1, disk_pct, net_rx_rate, net_tx_rate, uptime_sec, raw)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
        s.id,
        ts,
        Number(cpu.usage) || 0,
        Number(mem.pct) || 0,
        Number(mem.usedMb) || 0,
        Number(mem.totalMb) || 0,
        Number(load.load1) || 0,
        rootDiskPct(metrics),
        Number(net.rxRate) || 0,
        Number(net.txRate) || 0,
        Number(metrics.uptimeSec) || 0,
        JSON.stringify(metrics)
    );

    db.prepare("UPDATE servers SET status = 'online', last_seen_at = ?, os = ?, agent_version = ?, hostname = ? WHERE id = ?").run(
        Date.now(),
        (metrics.os && `${metrics.os.os || ''}`) || s.os,
        metrics.agentVersion || s.agent_version,
        (metrics.os && metrics.os.hostname) || s.hostname,
        s.id
    );

    alerter.evaluate(s, metrics);

    // 返回已审批待执行的动作
    const actions = db
        .prepare("SELECT * FROM actions WHERE server_id = ? AND status = 'approved' ORDER BY id LIMIT 3")
        .all(s.id)
        .map((a) => ({ id: a.id, type: a.type, params: a.params ? JSON.parse(a.params) : {}, createdAt: a.approved_at || a.created_at }));

    if (actions.length) {
        const ids = actions.map((a) => a.id);
        db.prepare(`UPDATE actions SET status = 'running' WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
    }

    res.json({ ok: true, actions, intervalMs: Number(getSetting('metric.reportIntervalMs') || 10000) });
});

/* ---------------- 动作结果 ---------------- */

router.post('/action-result', (req, res) => {
    const s = serverByToken(bearer(req));
    if (!s) return res.status(401).json({ ok: false, error: 'Token 无效' });
    const { actionId, ok, output } = req.body || {};
    if (!actionId) return res.status(400).json({ ok: false, error: '缺少 actionId' });

    const action = db.prepare('SELECT * FROM actions WHERE id = ? AND server_id = ?').get(actionId, s.id);
    if (!action) return res.status(404).json({ ok: false, error: '动作不存在' });

    db.prepare("UPDATE actions SET status = ?, finished_at = ?, output = ?, error = ? WHERE id = ?").run(
        ok ? 'done' : 'failed',
        Date.now(),
        String(output || '').slice(0, 100000),
        ok ? null : String(output || '').slice(0, 2000),
        action.id
    );
    db.prepare('INSERT INTO audit (actor, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)').run(
        'agent:' + s.id,
        'action.result',
        action.type,
        `${ok ? '成功' : '失败'}：${String(output || '').slice(0, 300)}`,
        Date.now()
    );
    res.json({ ok: true });
});

module.exports = router;
