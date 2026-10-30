import { useEffect, useMemo, useRef, useState } from 'react';

/** 迷你折线图（纯 SVG，无依赖） */
export default function Spark({ points = [], color = 'var(--primary)', height = 64, max = 100, fill = true }) {
    const data = points.filter((v) => Number.isFinite(Number(v))).map(Number);
    if (data.length === 0) {
        return <svg className="spark" viewBox="0 0 100 40" preserveAspectRatio="none"><line x1="0" y1="39" x2="100" y2="39" stroke="var(--border)" strokeWidth="1" /></svg>;
    }
    const n = data.length;
    const peak = Math.max(max, ...data) * 1.05 || 1;
    const step = n > 1 ? 100 / (n - 1) : 100;
    const pts = data.map((v, i) => `${(i * step).toFixed(2)},${(40 - (v / peak) * 38).toFixed(2)}`);
    const line = pts.join(' ');
    const area = `0,40 ${line} 100,40`;
    return (
        <svg className="spark" viewBox="0 0 100 40" preserveAspectRatio="none" style={{ height }}>
            {fill && <polygon points={area} fill={color} opacity="0.14" />}
            <polyline points={line} fill="none" stroke={color} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
        </svg>
    );
}

/** 轻量 Toast */
export function useToast() {
    const [items, setItems] = useState([]);
    const push = (text, type = 'ok') => {
        const id = Date.now() + Math.random();
        setItems((v) => [...v, { id, text, type }]);
        setTimeout(() => setItems((v) => v.filter((t) => t.id !== id)), 3200);
    };
    const node = (
        <div className="toast-stack">
            {items.map((t) => (
                <div key={t.id} className={`toast ${t.type === 'bad' ? 'is-bad' : 'is-ok'}`}>
                    {t.text}
                </div>
            ))}
        </div>
    );
    return { push, node };
}

/** 定时轮询 */
export function usePoll(fn, intervalMs = 10000, deps = []) {
    const saved = useRef(fn);
    saved.current = fn;
    useEffect(() => {
        let alive = true;
        const tick = async () => {
            if (!alive) return;
            try {
                await saved.current();
            } catch {
                /* 静默，避免刷屏 */
            }
        };
        tick();
        const timer = setInterval(tick, intervalMs);
        return () => {
            alive = false;
            clearInterval(timer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
}

export function MetricLine({ label, pct, valueText, warn = 80, critical = 90 }) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    const cls = p >= critical ? 'is-critical' : p >= warn ? 'is-warn' : '';
    return (
        <div className="metric-line">
            <span className="k">{label}</span>
            <span className="b">
                <span className={`bar ${cls}`}>
                    <i style={{ width: p + '%' }} />
                </span>
            </span>
            <span className="v">{valueText || p.toFixed(0) + '%'}</span>
        </div>
    );
}

export function useMemoSorted(list, key) {
    return useMemo(() => [...list].sort((a, b) => (a[key] > b[key] ? 1 : -1)), [list, key]);
}
