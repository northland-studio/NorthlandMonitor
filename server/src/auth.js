/**
 * 认证：邮箱验证码登录（沿用现有 monitor 的交互习惯），会话 24 小时
 */
'use strict';

const crypto = require('node:crypto');
const nodemailer = require('nodemailer');
const { db, getSetting } = require('./db');

const SESSION_COOKIE = 'xj_monitor_sid';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function sha256(v) {
    return crypto.createHash('sha256').update(String(v)).digest('hex');
}

function parseCookies(header) {
    const out = {};
    for (const part of String(header || '').split(';')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
}

function smtpTransport() {
    const host = getSetting('smtp.host');
    const port = Number(getSetting('smtp.port') || 465);
    const user = getSetting('smtp.user');
    const pass = getSetting('smtp.pass');
    if (!host || !user || !pass) return null;
    return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
}

async function sendLoginCode(email) {
    const operator = db.prepare('SELECT * FROM operators WHERE email = ? AND active = 1').get(email);
    if (!operator) return { ok: false, error: '该邮箱不在运维人员名单中' };

    const code = String(Math.floor(100000 + Math.random() * 900000));
    db.prepare('DELETE FROM login_codes WHERE email = ?').run(email);
    db.prepare('INSERT INTO login_codes (email, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?)').run(
        email,
        sha256(code),
        Date.now() + CODE_TTL_MS,
        Date.now()
    );

    const transport = smtpTransport();
    if (!transport) {
        console.log(`[auth] SMTP 未配置，登录验证码（${operator.name || email} / ${email}）：${code}`);
        return { ok: true, fallback: true };
    }
    const displayName = String(operator.name || '').trim() || email.split('@')[0];
    try {
        await transport.sendMail({
            from: `"北域监控" <${getSetting('smtp.user')}>`,
            to: email,
            subject: `【北域工作台】监控面板登录验证码 · ${displayName}`,
            text: `${displayName}，你好：\n\n你的登录验证码是 ${code}，10 分钟内有效。\n如果不是你本人操作，请忽略本邮件。\n\n北域工作室 · Northland Studio`,
            html: `<div style="font-family:sans-serif;line-height:1.8;color:#1a2438">
                <p>${escapeHtml(displayName)}，你好：</p>
                <p>你的登录验证码是：</p>
                <p style="font-size:26px;font-weight:700;letter-spacing:6px;color:#1B45B8">${code}</p>
                <p style="color:#666">10 分钟内有效。如果不是你本人操作，请忽略本邮件。</p>
                <p style="color:#888;font-size:12px;margin-top:18px">北域工作室 · Northland Studio</p>
            </div>`
        });
        return { ok: true, name: displayName };
    } catch (e) {
        console.error('[auth] 发送验证码失败：', e.message);
        return { ok: false, error: '验证码邮件发送失败：' + e.message };
    }
}

function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function verifyLoginCode(email, code) {
    const row = db.prepare('SELECT * FROM login_codes WHERE email = ?').get(email);
    if (!row) return { ok: false, error: '请先获取验证码' };
    if (row.expires_at < Date.now()) return { ok: false, error: '验证码已过期' };
    if (row.attempts >= MAX_ATTEMPTS) return { ok: false, error: '尝试次数过多，请重新获取' };
    if (row.code_hash !== sha256(String(code))) {
        db.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?').run(email);
        return { ok: false, error: '验证码不正确' };
    }
    const operator = db.prepare('SELECT * FROM operators WHERE email = ? AND active = 1').get(email);
    if (!operator) return { ok: false, error: '该邮箱不在运维人员名单中' };
    db.prepare('DELETE FROM login_codes WHERE email = ?').run(email);

    const sid = crypto.randomBytes(24).toString('hex');
    db.prepare('INSERT INTO sessions (id, email, level, ip, ua, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        sid,
        email,
        operator.level,
        '',
        '',
        Date.now(),
        Date.now() + SESSION_TTL_MS
    );
    return { ok: true, sid, email, level: operator.level };
}

function sessionFromReq(req) {
    const cookies = parseCookies(req.headers.cookie);
    const sid = cookies[SESSION_COOKIE];
    if (!sid) return null;
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sid);
    if (!row) return null;
    if (row.expires_at < Date.now()) {
        db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
        return null;
    }
    return row;
}

function requireAuth(req, res, next) {
    const s = sessionFromReq(req);
    if (!s) return res.status(401).json({ ok: false, error: '未登录或会话已过期' });
    req.session = s;
    next();
}

function requireAdmin(req, res, next) {
    const s = sessionFromReq(req);
    if (!s) return res.status(401).json({ ok: false, error: '未登录或会话已过期' });
    if (s.level < 2) return res.status(403).json({ ok: false, error: '需要管理员权限' });
    req.session = s;
    next();
}

function setSessionCookie(res, sid) {
    res.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${process.env.COOKIE_SECURE === '0' ? '' : '; Secure'}`
    );
}

function clearSessionCookie(res) {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function cleanupSessions() {
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    db.prepare('DELETE FROM login_codes WHERE expires_at < ?').run(Date.now());
}

module.exports = {
    sendLoginCode,
    verifyLoginCode,
    sessionFromReq,
    requireAuth,
    requireAdmin,
    setSessionCookie,
    clearSessionCookie,
    cleanupSessions,
    sha256,
    parseCookies,
    SESSION_COOKIE
};
