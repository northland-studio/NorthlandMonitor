/**
 * 玄剑工作室监控面板 · 主控服务
 *
 * 职责：托管 Web 面板 + 提供 Agent 接入 API + 定时任务（离线检测/数据清理）
 */
'use strict';

// 最先加载 .env（PORT / DB_FILE / SMTP 等配置）
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });

const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const express = require('express');

const { db, DB_FILE, getSetting } = require('./db');
const agentRoutes = require('./routes/agent');
const apiRoutes = require('./routes/api');
const { cleanupSessions } = require('./auth');
const alerter = require('./services/alerter');
const reporter = require('./services/reporter');

const PORT = Number(process.env.PORT || 3002);
const HOST = process.env.HOST || '0.0.0.0';
const WEB_DIR = path.join(__dirname, '..', '..', 'web', 'dist');
const INSTALL_DIR = path.join(__dirname, '..', 'install');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '4mb' }));

/* ---------------- 静态资源 ---------------- */

app.use('/install', express.static(INSTALL_DIR, { fallthrough: true }));

if (fs.existsSync(WEB_DIR)) {
    // 缓存策略：
    //  - 带 hash 的 /assets/*  → 长期强缓存
    //  - index.html / sw.js / manifest → 不缓存，保证发版立即生效
    //  - 其他静态文件（logo、背景图）→ 1 小时
    app.use(
        express.static(WEB_DIR, {
            index: false,
            etag: true,
            setHeaders(res, filePath) {
                const rel = path.relative(WEB_DIR, filePath).split(path.sep).join('/');
                if (rel === 'sw.js' || rel === 'manifest.webmanifest' || rel.endsWith('.html')) {
                    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                    return;
                }
                if (rel.startsWith('assets/')) {
                    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
                    return;
                }
                res.setHeader('Cache-Control', 'public, max-age=3600');
            }
        })
    );
}

/* ---------------- API ---------------- */

app.use('/api/agent', agentRoutes);
app.use('/api', apiRoutes);

app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        service: 'northland-monitor',
        version: require('../package.json').version,
        uptimeSec: Math.round(process.uptime()),
        db: DB_FILE,
        now: Date.now()
    });
});

/* ---------------- SPA 兜底 ---------------- */

app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/install/')) return next();
    const indexFile = path.join(WEB_DIR, 'index.html');
    if (fs.existsSync(indexFile)) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        return res.sendFile(indexFile);
    }
    res.status(503).type('text/plain').send('Web 前端未构建：请先在 web 目录执行 npm run build');
});

/* ---------------- 定时任务 ---------------- */

function startJobs() {
    // 离线检测：每 30 秒
    setInterval(() => {
        alerter.checkOffline().catch((e) => console.error('[job] 离线检测失败：', e.message));
    }, 30000).unref();

    // 会话与验证码清理 + 指标/告警/审计保留：每 10 分钟
    setInterval(() => {
        try {
            cleanupSessions();
            const retentionDays = Math.max(Number(getSetting('metric.retentionDays') || 30), 1);
            const cutoff = Date.now() - retentionDays * 86400000;
            const deleted = db.prepare('DELETE FROM metrics WHERE ts < ?').run(cutoff).changes;
            if (deleted) console.log(`[job] 清理过期指标 ${deleted} 条（保留 ${retentionDays} 天）`);
            db.prepare("DELETE FROM alerts WHERE status = 'resolved' AND resolved_at < ?").run(Date.now() - 30 * 86400000);
            db.prepare('DELETE FROM audit WHERE created_at < ?').run(Date.now() - 90 * 86400000);
            db.prepare('DELETE FROM install_tokens WHERE expires_at < ? AND used_at IS NULL').run(Date.now() - 86400000);
        } catch (e) {
            console.error('[job] 清理失败：', e.message);
        }
    }, 10 * 60000).unref();

    // 定时日报：每分钟检查一次是否到点
    setInterval(() => {
        reporter.tick().catch((e) => console.error('[job] 日报检查失败：', e.message));
    }, 60000).unref();
}

/* ---------------- 启动 ---------------- */

const server = http.createServer(app);

server.listen(PORT, HOST, () => {
    console.log(`[northland-monitor] 主控已启动：http://${HOST}:${PORT}`);
    console.log(`[northland-monitor] 数据库：${DB_FILE}`);
    console.log(`[northland-monitor] Web 目录：${WEB_DIR}${fs.existsSync(WEB_DIR) ? '' : '（不存在，需构建）'}`);

    // 首次启动若没有任何运维账号，从环境变量初始化
    const count = db.prepare('SELECT COUNT(*) c FROM operators').get().c;
    if (count === 0) {
        const seed = (process.env.SEED_OPERATORS || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        for (const email of seed) {
            const level = process.env.SEED_ADMIN_EMAIL && process.env.SEED_ADMIN_EMAIL === email ? 2 : 1;
            db.prepare('INSERT OR IGNORE INTO operators (email, name, level, active, created_at) VALUES (?, ?, ?, 1, ?)').run(email, email, level, Date.now());
            console.log(`[northland-monitor] 初始化运维账号：${email}（level=${level}）`);
        }
        if (!seed.length) {
            console.log('[northland-monitor] 未配置 SEED_OPERATORS，面板暂时无法登录；可通过环境变量补充运维邮箱');
        }
    }

    startJobs();
});

function shutdown(sig) {
    console.log(`[northland-monitor] 收到 ${sig}，正在关闭…`);
    server.close(() => {
        try {
            db.close();
        } catch {
            /* ignore */
        }
        process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (e) => console.error('[northland-monitor] 未捕获异常：', e));
process.on('unhandledRejection', (e) => console.error('[northland-monitor] 未处理 Promise：', e));

module.exports = app;
