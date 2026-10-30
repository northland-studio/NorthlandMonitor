import { useCallback, useEffect, useState } from 'react';
import { api } from './lib/api.js';
import { useToast } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import NodeDetail from './pages/NodeDetail.jsx';
import Alerts from './pages/Alerts.jsx';
import AddNode from './pages/AddNode.jsx';
import Settings from './pages/Settings.jsx';

const NAV = [
    ['overview', '总览'],
    ['alerts', '告警'],
    ['add', '添加节点'],
    ['settings', '设置']
];

export default function App() {
    const toast = useToast();
    const [session, setSession] = useState(null);
    const [checking, setChecking] = useState(true);
    const [route, setRoute] = useState({ name: 'overview' });
    const [servers, setServers] = useState([]);
    const [stats, setStats] = useState({ servers: 0, online: 0, openAlerts: 0, pendingActions: 0, metricsCount: 0 });
    const [theme, setTheme] = useState(() => localStorage.getItem('northland-monitor-theme') || 'dark');

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('northland-monitor-theme', theme);
    }, [theme]);

    useEffect(() => {
        api.get('/api/auth/me')
            .then((r) => setSession(r))
            .catch(() => setSession(null))
            .finally(() => setChecking(false));
    }, []);

    const refresh = useCallback(async () => {
        const [s, st] = await Promise.all([api.get('/api/servers'), api.get('/api/stats')]);
        setServers(s.servers || []);
        setStats(st);
    }, []);

    useEffect(() => {
        if (!session) return;
        refresh().catch(() => {});
        const t = setInterval(() => refresh().catch(() => {}), 10000);
        return () => clearInterval(t);
    }, [session, refresh]);

    if (checking) {
        return (
            <div className="login-wrap">
                <div className="empty">正在检查登录状态…</div>
            </div>
        );
    }

    if (!session) {
        return (
            <>
                <Login onLogin={(r) => setSession({ ...r, email: r.email, level: r.level })} toast={toast.push} />
                {toast.node}
            </>
        );
    }

    const logout = async () => {
        try {
            await api.post('/api/auth/logout');
        } catch {
            /* ignore */
        }
        setSession(null);
        setRoute({ name: 'overview' });
    };

    return (
        <div className="app">
            <aside className="side">
                <div className="brand">
                    <img className="brand-logo" src="/logo.png" alt="北域工作室" />
                    <div>
                        <div className="brand-name">北域工作室</div>
                        <div className="brand-sub">Northland Studio</div>
                    </div>
                </div>
                <nav className="nav">
                    {NAV.map(([key, label]) => (
                        <button
                            key={key}
                            className={`nav-item ${route.name === key || (key === 'overview' && route.name === 'node') ? 'is-active' : ''}`}
                            onClick={() => setRoute({ name: key })}
                        >
                            <span className="nav-dot" />
                            {label}
                            {key === 'alerts' && stats.openAlerts > 0 && (
                                <span className="pill is-offline" style={{ marginLeft: 'auto' }}>
                                    {stats.openAlerts}
                                </span>
                            )}
                        </button>
                    ))}
                </nav>
                <div className="side-foot">
                    <button className="btn btn-sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                        {theme === 'dark' ? '切换浅色' : '切换深色'}
                    </button>
                    <div className="side-user">
                        <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {session.email}
                        </span>
                        <button className="btn btn-sm" onClick={logout}>
                            退出
                        </button>
                    </div>
                    <div className="mono">v2.0.0 · {stats.online}/{stats.servers} 在线</div>
                </div>
            </aside>

            <main className="main">
                {route.name === 'overview' && (
                    <Overview servers={servers} stats={stats} onOpen={(id) => setRoute({ name: 'node', id })} refresh={refresh} toast={toast.push} />
                )}
                {route.name === 'node' && <NodeDetail id={route.id} onBack={() => setRoute({ name: 'overview' })} toast={toast.push} session={session} />}
                {route.name === 'alerts' && <Alerts toast={toast.push} />}
                {route.name === 'add' && <AddNode toast={toast.push} session={session} />}
                {route.name === 'settings' && <Settings toast={toast.push} session={session} />}
            </main>
            {toast.node}
        </div>
    );
}
