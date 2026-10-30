#!/usr/bin/env node
/**
 * 玄剑工作室监控 Agent（单文件、零依赖）
 *
 * 职责：
 *  1. 注册到主控（一次性 Token）
 *  2. 定时采集指标并上报（CPU/内存/磁盘/网络/负载/进程/PM2/systemd/fail2ban）
 *  3. 心跳 + 拉取白名单动作并执行，回传结果
 *
 * 安全设计：
 *  - 只主动出站，不监听任何端口
 *  - 动作必须同时满足：主控已审批 + 动作类型在本地白名单 + 参数通过本地校验 + 时间戳新鲜
 *  - 远程 Shell 不在白名单内；日志读取限定在允许目录
 *
 * 配置：/etc/xuanjian-agent/config.json
 *  { "master": "https://monitor.xuanjian.top", "token": "一次性Token" }
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const http = require('node:http');
const { exec } = require('node:child_process');

const CONFIG_PATH = process.env.AGENT_CONFIG || '/etc/xuanjian-agent/config.json';
const STATE_PATH = '/etc/xuanjian-agent/state.json';
const VERSION = '2.0.0';
const LOG_PATH = '/var/log/xuanjian-agent.log';

/* ---------------- 基础工具 ---------------- */

function log(...args) {
    const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
    try {
        fs.appendFileSync(LOG_PATH, line + '\n');
    } catch {
        /* 无写权限时忽略 */
    }
    console.log(line);
}

function readJson(p) {
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
        return null;
    }
}

function writeJson(p, v) {
    fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
    fs.writeFileSync(p, JSON.stringify(v, null, 2), { mode: 0o600 });
}

function sh(cmd, timeout = 8000) {
    return new Promise((resolve) => {
        exec(cmd, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
            resolve(err ? '' : String(stdout || ''));
        });
    });
}

/* ---------------- 采集 ---------------- */

let lastCpu = null;
let lastNet = null;

function readCpuTimes() {
    try {
        const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
        const parts = line.trim().split(/\s+/).slice(1).map(Number);
        const idle = parts[3] + (parts[4] || 0);
        const total = parts.reduce((a, b) => a + b, 0);
        return { idle, total };
    } catch {
        return null;
    }
}

function cpuUsage() {
    const cur = readCpuTimes();
    if (!cur) return { usage: 0, cores: os.cpus().length };
    let usage = 0;
    if (lastCpu) {
        const dt = cur.total - lastCpu.total;
        const di = cur.idle - lastCpu.idle;
        usage = dt > 0 ? Math.max(0, Math.min(100, (1 - di / dt) * 100)) : 0;
    }
    lastCpu = cur;
    return { usage: Number(usage.toFixed(1)), cores: os.cpus().length };
}

function memory() {
    try {
        const m = {};
        for (const line of fs.readFileSync('/proc/meminfo', 'utf8').split('\n')) {
            const [k, v] = line.split(':');
            if (k && v) m[k.trim()] = Number(v.trim().split(/\s+/)[0]);
        }
        const total = m.MemTotal || 0;
        const avail = m.MemAvailable || m.MemFree || 0;
        const swapTotal = m.SwapTotal || 0;
        const swapFree = m.SwapFree || 0;
        return {
            totalMb: Math.round(total / 1024),
            usedMb: Math.round((total - avail) / 1024),
            availMb: Math.round(avail / 1024),
            pct: total ? Number((((total - avail) / total) * 100).toFixed(1)) : 0,
            swapTotalMb: Math.round(swapTotal / 1024),
            swapFreeMb: Math.round(swapFree / 1024)
        };
    } catch {
        const total = os.totalmem();
        const free = os.freemem();
        return {
            totalMb: Math.round(total / 1048576),
            usedMb: Math.round((total - free) / 1048576),
            availMb: Math.round(free / 1048576),
            pct: Number((((total - free) / total) * 100).toFixed(1)),
            swapTotalMb: 0,
            swapFreeMb: 0
        };
    }
}

async function disks() {
    const out = await sh("df -P -k 2>/dev/null | awk 'NR>1 && $1 ~ /^\\/dev\\// {print $1\"|\"$2\"|\"$3\"|\"$4\"|\"$5\"|\"$6}'");
    const rows = [];
    for (const line of out.split('\n')) {
        if (!line.trim()) continue;
        const [dev, total, used, avail, pct, mount] = line.split('|');
        rows.push({
            dev,
            mount,
            totalMb: Math.round(Number(total) / 1024),
            usedMb: Math.round(Number(used) / 1024),
            availMb: Math.round(Number(avail) / 1024),
            pct: Number(String(pct).replace('%', ''))
        });
    }
    // 只保留挂载点较短的（避免容器/临时挂载刷屏）
    return rows
        .filter((d) => d.mount && d.mount.split('/').length <= 3)
        .sort((a, b) => b.totalMb - a.totalMb)
        .slice(0, 6);
}

function network() {
    try {
        const lines = fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2);
        let rx = 0;
        let tx = 0;
        for (const line of lines) {
            const parts = line.split(':');
            if (parts.length !== 2) continue;
            iface: {
                const name = parts[0].trim();
                if (name === 'lo') break iface;
                const nums = parts[1].trim().split(/\s+/).map(Number);
                rx += nums[0] || 0;
                tx += nums[8] || 0;
            }
        }
        const now = Date.now();
        let rxRate = 0;
        let txRate = 0;
        if (lastNet) {
            const dt = (now - lastNet.at) / 1000;
            if (dt > 0) {
                rxRate = Math.max(0, Math.round((rx - lastNet.rx) / dt));
                txRate = Math.max(0, Math.round((tx - lastNet.tx) / dt));
            }
        }
        lastNet = { rx, tx, at: now };
        return { rxBytes: rx, txBytes: tx, rxRate, txRate };
    } catch {
        return { rxBytes: 0, txBytes: 0, rxRate: 0, txRate: 0 };
    }
}

function loadAvg() {
    try {
        const p = fs.readFileSync('/proc/loadavg', 'utf8').trim().split(/\s+/).map(Number);
        return { load1: p[0], load5: p[1], load15: p[2], procs: Number((p[3] || '0/0').split('/')[1] || 0) };
    } catch {
        return { load1: os.loadavg()[0], load5: os.loadavg()[1], load15: os.loadavg()[2], procs: 0 };
    }
}

function uptimeSec() {
    try {
        return Math.round(Number(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]));
    } catch {
        return Math.round(os.uptime());
    }
}

async function topProcesses(limit = 12) {
    const out = await sh(`ps -eo pid,pcpu,pmem,rss,etime,comm --sort=-pcpu --no-headers 2>/dev/null | head -${limit}`);
    return out
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => {
            const parts = l.trim().split(/\s+/);
            return {
                pid: Number(parts[0]),
                cpu: Number(parts[1]),
                mem: Number(parts[2]),
                rssMb: Math.round(Number(parts[3]) / 1024),
                etime: parts[4],
                name: parts.slice(5).join(' ')
            };
        });
}

async function pm2List() {
    const exists = await sh('command -v pm2 >/dev/null && echo yes');
    if (!exists.trim()) return [];
    // systemd 环境下 HOME/PATH 可能不完整，显式补上并回退到登录 shell
    let out = await sh('env HOME=/root PATH=/usr/local/bin:/usr/bin:/bin pm2 jlist 2>/dev/null');
    if (!out.trim()) out = await sh("bash -lc 'pm2 jlist' 2>/dev/null");
    if (!out.trim()) return [];
    try {
        const arr = JSON.parse(out);
        return arr.map((p) => {
            const e = p.pm2_env || {};
            const mon = p.monit || {};
            return {
                name: e.name,
                status: e.status,
                restarts: e.restart_time || 0,
                cpu: mon.cpu || 0,
                memMb: Math.round((mon.memory || 0) / 1048576),
                uptimeSec: e.pm_uptime ? Math.round((Date.now() - e.pm_uptime) / 1000) : 0
            };
        });
    } catch {
        return [];
    }
}

function parseUnits(out) {
    return out
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => l.split(/\s+/).find((t) => /\.service$/.test(t)))
        .filter(Boolean);
}

async function systemdSummary() {
    const out = await sh('systemctl list-units --type=service --state=running --no-legend --no-pager 2>/dev/null');
    const units = parseUnits(out);
    const failedOut = await sh('systemctl list-units --type=service --state=failed --no-legend --no-pager 2>/dev/null');
    const failed = parseUnits(failedOut);
    return { runningCount: units.length, running: units.slice(0, 40), failed };
}

async function fail2ban() {
    const has = await sh('command -v fail2ban-client >/dev/null && echo yes');
    if (!has.trim()) return { installed: false, jails: [] };
    const status = await sh('fail2ban-client status 2>/dev/null');
    const jails = [];
    const m = /Jail list:\s*(.+)/.exec(status);
    if (m) {
        for (const jail of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
            const detail = await sh(`fail2ban-client status ${jail} 2>/dev/null`);
            const banned = /Currently banned:\s*(\d+)/.exec(detail);
            const total = /Total banned:\s*(\d+)/.exec(detail);
            const listMatch = /Banned IP list:\s*(.*)/.exec(detail);
            const bannedIps = listMatch
                ? listMatch[1]
                      .split(/\s+/)
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .slice(0, 30)
                : [];
            jails.push({
                name: jail,
                currentlyBanned: banned ? Number(banned[1]) : 0,
                totalBanned: total ? Number(total[1]) : 0,
                bannedIps
            });
        }
    }
    return { installed: true, jails };
}

function osInfo() {
    let pretty = 'unknown';
    try {
        const rel = fs.readFileSync('/etc/os-release', 'utf8');
        const m = /PRETTY_NAME="([^"]+)"/.exec(rel);
        if (m) pretty = m[1];
    } catch {
        /* ignore */
    }
    return {
        hostname: os.hostname(),
        os: pretty,
        kernel: os.release(),
        arch: os.arch(),
        nodeVersion: process.version
    };
}

async function collect() {
    const [diskList, procs, pm2, sysd, f2b] = await Promise.all([
        disks(),
        topProcesses(),
        pm2List(),
        systemdSummary(),
        fail2ban()
    ]);
    const cpu = cpuUsage();
    const mem = memory();
    const net = network();
    const load = loadAvg();
    return {
        ts: Date.now(),
        agentVersion: VERSION,
        os: osInfo(),
        cpu,
        mem,
        load,
        uptimeSec: uptimeSec(),
        disks: diskList,
        net,
        procs,
        pm2,
        systemd: sysd,
        fail2ban: f2b
    };
}

/* ---------------- HTTP 客户端（零依赖） ---------------- */

function request(baseUrl, method, urlPath, token, body, timeoutMs = 20000) {
    return new Promise((resolve) => {
        let u;
        try {
            u = new URL(urlPath, baseUrl);
        } catch {
            return resolve({ ok: false, status: 0, error: 'bad url' });
        }
        const isHttps = u.protocol === 'https:';
        const data = body ? Buffer.from(JSON.stringify(body)) : null;
        const headers = { 'User-Agent': `xuanjian-agent/${VERSION}` };
        if (token) headers['X-Agent-Token'] = token;
        if (data) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = data.length;
        } else if (method !== 'GET') {
            headers['Content-Length'] = 0;
        }
        const mod = isHttps ? https : http;
        const req = mod.request(
            {
                hostname: u.hostname,
                port: u.port || (isHttps ? 443 : 80),
                path: u.pathname + u.search,
                method,
                headers,
                timeout: timeoutMs,
                rejectUnauthorized: true
            },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    let json = null;
                    try {
                        json = JSON.parse(text);
                    } catch {
                        json = null;
                    }
                    resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json, text });
                });
            }
        );
        req.on('timeout', () => {
            req.destroy();
            resolve({ ok: false, status: 0, error: 'timeout' });
        });
        req.on('error', (e) => resolve({ ok: false, status: 0, error: e.message }));
        if (data) req.write(data);
        req.end();
    });
}

/* ---------------- 白名单动作 ---------------- */

/** 允许重启/操作的 systemd 单元白名单（前缀匹配） */
const ALLOWED_UNITS = [
    'xuanjian-group-bot',
    'napcat',
    'nginx',
    'mysql',
    'redis',
    'docker',
    'fail2ban',
    'xuanjian-'
];
/** 允许操作的 pm2 进程白名单（前缀匹配） */
const ALLOWED_PM2 = ['xuanjian-guild', 'monitor', 'zhuopu', 'beiyu', 'nork', 'northbooker', 'xuanjian-notice', 'napcat'];
/** 允许读取的日志目录（路径必须以这些前缀开头） */
const ALLOWED_LOG_PREFIXES = ['/var/log/', '/var/www/', '/opt/', '/root/.pm2/logs/'];
/** 文件管理允许访问的根目录（只读） */
const ALLOWED_FILE_ROOTS = ['/var/www/', '/var/log/', '/opt/', '/root/', '/etc/nginx/', '/srv/', '/home/', '/tmp/'];

function inWhitelist(value, list) {
    return list.some((p) => value === p || value.startsWith(p));
}

/** 把路径规范化并校验是否在允许的根目录内（防目录穿越） */
function safeFilePath(input, { allowRootDir = false } = {}) {
    const raw = String(input || '/var/www');
    if (raw.includes('\0') || raw.includes('..')) return null;
    let resolved;
    try {
        resolved = fs.realpathSync(raw);
    } catch {
        resolved = path.normalize(raw);
    }
    const isDir = (() => {
        try {
            return fs.statSync(resolved).isDirectory();
        } catch {
            return false;
        }
    })();
    if (isDir && !allowRootDir) {
        // 目录本身也要在白名单内
    }
    const ok = ALLOWED_FILE_ROOTS.some((root) => resolved === root.replace(/\/$/, '') || resolved.startsWith(root));
    return ok ? resolved : null;
}

function isBinary(buf) {
    const n = Math.min(buf.length, 4096);
    for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
    return false;
}

const ACTIONS = {
    'service.restart': {
        validate: (p) => inWhitelist(String(p.unit || ''), ALLOWED_UNITS),
        run: async (p) => sh(`systemctl restart ${JSON.stringify(p.unit)}`, 60000) && `已重启 ${p.unit}`
    },
    'service.start': {
        validate: (p) => inWhitelist(String(p.unit || ''), ALLOWED_UNITS),
        run: async (p) => sh(`systemctl start ${JSON.stringify(p.unit)}`, 60000) && `已启动 ${p.unit}`
    },
    'service.stop': {
        validate: (p) => inWhitelist(String(p.unit || ''), ALLOWED_UNITS),
        run: async (p) => sh(`systemctl stop ${JSON.stringify(p.unit)}`, 60000) && `已停止 ${p.unit}`
    },
    'pm2.restart': {
        validate: (p) => inWhitelist(String(p.name || ''), ALLOWED_PM2),
        run: async (p) => sh(`pm2 restart ${JSON.stringify(p.name)} --update-env`, 60000) && `已重启 pm2:${p.name}`
    },
    'log.tail': {
        validate: (p) => {
            const f = String(p.path || '');
            return ALLOWED_LOG_PREFIXES.some((pre) => f.startsWith(pre)) && !f.includes('..');
        },
        run: async (p) => {
            const lines = Math.min(Math.max(Number(p.lines) || 100, 1), 1000);
            const out = await sh(`tail -n ${lines} ${JSON.stringify(p.path)}`, 15000);
            return out.slice(0, 200000);
        }
    },
    'disk.cleanup': {
        validate: (p) => inWhitelist(String(p.target || ''), ['/var/beifen/', '/opt/minecraft-backups/', '/tmp/']),
        run: async (p) => {
            const t = String(p.target || '');
            const keep = Math.max(Number(p.keepDays) || 3, 1);
            if (!t.endsWith('/')) return '目标必须以 / 结尾';
            const out = await sh(`find ${JSON.stringify(t)} -maxdepth 1 -type f -mtime +${keep} -delete -print 2>/dev/null | wc -l`, 30000);
            return `已清理 ${out.trim()} 个超过 ${keep} 天的文件`;
        }
    },
    'log.list': {
        validate: () => true,
        run: async () => {
            const rows = [];
            const listDir = async (dir, label) => {
                const out = await sh(`find ${JSON.stringify(dir)} -maxdepth 1 -type f -name '*.log' -size -50M 2>/dev/null | head -40`);
                for (const f of out.split('\n').map((s) => s.trim()).filter(Boolean)) {
                    const stat = await sh(`stat -c '%s %Y' ${JSON.stringify(f)} 2>/dev/null`);
                    const [size, mtime] = stat.trim().split(/\s+/);
                    rows.push({ path: f, group: label, size: Number(size) || 0, mtime: Number(mtime) * 1000 || 0 });
                }
            };
            await listDir('/var/log', '系统日志');
            await listDir('/root/.pm2/logs', 'PM2 日志');
            await listDir('/var/www', '站点日志');
            rows.sort((a, b) => b.mtime - a.mtime);
            return JSON.stringify(rows.slice(0, 60));
        }
    },
    'fail2ban.ban': {
        validate: (p) => /^[a-zA-Z0-9_.-]{1,40}$/.test(String(p.jail || '')) && /^[0-9a-fA-F.:]{3,45}$/.test(String(p.ip || '')),
        run: async (p) => {
            const out = await sh(`fail2ban-client set ${p.jail} banip ${p.ip} 2>&1`, 20000);
            return out.trim() || '已执行封禁';
        }
    },
    'fail2ban.unban': {
        validate: (p) => /^[a-zA-Z0-9_.-]{1,40}$/.test(String(p.jail || '')) && /^[0-9a-fA-F.:]{3,45}$/.test(String(p.ip || '')),
        run: async (p) => {
            const out = await sh(`fail2ban-client set ${p.jail} unbanip ${p.ip} 2>&1`, 20000);
            return out.trim() || '已执行解封';
        }
    },
    'file.list': {
        validate: (p) => safeFilePath(p.path || '/var/www', { allowRootDir: true }) !== null,
        run: async (p) => {
            const dir = safeFilePath(p.path || '/var/www', { allowRootDir: true });
            if (!dir) return JSON.stringify({ error: '路径不在允许范围内' });
            let names;
            try {
                names = fs.readdirSync(dir, { withFileTypes: true });
            } catch (e) {
                return JSON.stringify({ error: '读取目录失败：' + e.message });
            }
            const entries = names
                .filter((d) => !d.name.startsWith('.git'))
                .map((d) => {
                    const full = path.join(dir, d.name);
                    let size = 0;
                    let mtime = 0;
                    try {
                        const st = fs.lstatSync(full);
                        size = st.size;
                        mtime = st.mtimeMs;
                    } catch {
                        /* ignore */
                    }
                    return { name: d.name, path: full, isDir: d.isDirectory(), isLink: d.isSymbolicLink(), size, mtime };
                })
                .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
            return JSON.stringify({ path: dir, parent: path.dirname(dir), entries });
        }
    },
    'file.read': {
        validate: (p) => safeFilePath(p.path) !== null,
        run: async (p) => {
            const file = safeFilePath(p.path);
            if (!file) return '路径不在允许范围内';
            let st;
            try {
                st = fs.statSync(file);
            } catch (e) {
                return '读取失败：' + e.message;
            }
            if (st.isDirectory()) return '这是一个目录，请先进入目录';
            const maxBytes = Math.min(Math.max(Number(p.maxBytes) || 262144, 1024), 1048576);
            const fd = fs.openSync(file, 'r');
            const buf = Buffer.alloc(Math.min(st.size, maxBytes));
            fs.readSync(fd, buf, 0, buf.length, 0);
            fs.closeSync(fd);
            if (isBinary(buf)) return '__BINARY__:' + file;
            return buf.toString('utf8');
        }
    },
    'file.download': {
        validate: (p) => safeFilePath(p.path) !== null,
        run: async (p) => {
            const file = safeFilePath(p.path);
            if (!file) return JSON.stringify({ error: '路径不在允许范围内' });
            let st;
            try {
                st = fs.statSync(file);
            } catch (e) {
                return JSON.stringify({ error: '读取失败：' + e.message });
            }
            if (st.isDirectory()) return JSON.stringify({ error: '目录不能下载' });
            if (st.size > 1048576) return JSON.stringify({ error: `文件 ${(st.size / 1048576).toFixed(1)}MB 超过 1MB 下载限制` });
            const buf = fs.readFileSync(file);
            return JSON.stringify({ name: path.basename(file), size: st.size, base64: buf.toString('base64') });
        }
    },
    'system.info': {
        validate: () => true,
        run: async () => {
            const [u, d, f] = await Promise.all([sh('uptime'), sh('df -h /'), sh('free -m')]);
            return [u, d, f].join('\n').slice(0, 20000);
        }
    }
};

async function runAction(action) {
    const def = ACTIONS[action.type];
    if (!def) return { ok: false, output: `动作类型不在白名单: ${action.type}` };
    if (!def.validate(action.params || {})) return { ok: false, output: '参数未通过本地白名单校验' };
    // 时间戳新鲜度（防止重放）
    const age = Date.now() - Number(action.createdAt || 0);
    if (!Number.isFinite(age) || age > 120000) return { ok: false, output: '动作已过期（超过 2 分钟）' };
    try {
        const output = await def.run(action.params || {});
        return { ok: true, output: String(output || '完成').slice(0, 200000) };
    } catch (e) {
        return { ok: false, output: '执行失败: ' + (e && e.message ? e.message : String(e)) };
    }
}

/* ---------------- 主循环 ---------------- */

async function main() {
    const cfg = readJson(CONFIG_PATH);
    if (!cfg || !cfg.master || !cfg.token) {
        log('缺少配置：需要在 ' + CONFIG_PATH + ' 写入 {"master":"...","token":"..."}');
        process.exit(1);
    }
    const master = String(cfg.master).replace(/\/+$/, '');
    let state = readJson(STATE_PATH) || {};

    log(`Agent ${VERSION} 启动，主控 ${master}，主机 ${os.hostname()}`);

    if (!state.serverId) {
        log('未注册，正在注册…');
        const info = await collect();
        const res = await request(master, 'POST', '/api/agent/register', cfg.token, {
            hostname: os.hostname(),
            os: info.os,
            agentVersion: VERSION
        });
        if (!res.ok || !res.json || !res.json.serverId) {
            log('注册失败：' + (res.json && res.json.error ? res.json.error : res.text || res.status || res.error));
            process.exit(1);
        }
        state = { serverId: res.json.serverId, intervalMs: res.json.intervalMs || 10000, token: res.json.token || cfg.token };
        writeJson(STATE_PATH, state);
        log(`注册成功，serverId=${state.serverId}，采集间隔 ${state.intervalMs}ms`);
    }

    const token = state.token || cfg.token;
    const interval = Math.max(5000, Math.min(Number(state.intervalMs) || 10000, 60000));
    let consecutiveFails = 0;

    const tick = async () => {
        try {
            const metrics = await collect();
            const res = await request(master, 'POST', '/api/agent/report', token, {
                serverId: state.serverId,
                metrics
            });
            if (!res.ok) {
                consecutiveFails++;
                log(`上报失败(${consecutiveFails})：` + (res.status ? 'HTTP ' + res.status : res.error || 'unknown'));
                if (res.status === 401 || res.status === 403) {
                    log('Token 失效，清理 state 后退出等待重新安装');
                    try {
                        fs.unlinkSync(STATE_PATH);
                    } catch {
                        /* ignore */
                    }
                    process.exit(2);
                }
            } else {
                if (consecutiveFails > 0) log('上报恢复正常');
                consecutiveFails = 0;
                // 同一次响应里返回待执行动作，省一次请求
                const actions = (res.json && res.json.actions) || [];
                for (const action of actions) {
                    log(`执行动作 ${action.id} ${action.type}`);
                    const result = await runAction(action);
                    await request(master, 'POST', '/api/agent/action-result', token, {
                        serverId: state.serverId,
                        actionId: action.id,
                        ok: result.ok,
                        output: result.output
                    });
                }
            }
        } catch (e) {
            log('tick 异常：' + (e && e.stack ? e.stack : e));
        }
        setTimeout(tick, interval);
    };

    tick();

    for (const sig of ['SIGTERM', 'SIGINT']) {
        process.on(sig, () => {
            log(`收到 ${sig}，退出`);
            process.exit(0);
        });
    }
    process.on('uncaughtException', (e) => log('未捕获异常：' + (e && e.stack ? e.stack : e)));
    process.on('unhandledRejection', (e) => log('未处理 Promise：' + String(e)));
}

main();
