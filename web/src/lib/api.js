/**
 * 极简 API 封装：统一 JSON、错误处理、401 跳登录
 */
const BASE = '';

async function request(path, options = {}) {
    const res = await fetch(BASE + path, {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options
    });
    let data = null;
    try {
        data = await res.json();
    } catch {
        data = null;
    }
    if (!res.ok) {
        const err = new Error((data && data.error) || `请求失败（${res.status}）`);
        err.status = res.status;
        err.data = data;
        throw err;
    }
    return data;
}

export const api = {
    get: (p) => request(p),
    post: (p, body) => request(p, { method: 'POST', body: JSON.stringify(body || {}) }),
    put: (p, body) => request(p, { method: 'PUT', body: JSON.stringify(body || {}) }),
    patch: (p, body) => request(p, { method: 'PATCH', body: JSON.stringify(body || {}) }),
    del: (p) => request(p, { method: 'DELETE' })
};

/* ---------------- 格式化 ---------------- */

export function fmtBytes(n) {
    n = Number(n) || 0;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i++;
    }
    return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtRate(n) {
    return fmtBytes(n) + '/s';
}

export function fmtUptime(sec) {
    sec = Number(sec) || 0;
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d} 天 ${h} 小时`;
    if (h > 0) return `${h} 小时 ${m} 分`;
    return `${m} 分钟`;
}

export function timeAgo(ts) {
    if (!ts) return '—';
    const diff = Math.max(0, Date.now() - Number(ts));
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s} 秒前`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} 分钟前`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} 小时前`;
    return `${Math.floor(h / 24)} 天前`;
}

export function fmtTime(ts) {
    if (!ts) return '—';
    const d = new Date(Number(ts));
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function levelClass(pct) {
    if (pct >= 90) return 'is-critical';
    if (pct >= 80) return 'is-warn';
    return 'is-ok';
}
