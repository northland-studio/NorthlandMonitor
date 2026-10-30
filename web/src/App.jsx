import { useCallback, useEffect, useState } from 'react';
import { api } from './lib/api.js';
import { useToast } from './components/ui.jsx';
import { IconOverview, IconAlert, IconAddNode, IconSettings, IconLogout, IconSun, IconMoon } from './components/icons.jsx';
import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import NodeDetail from './pages/NodeDetail.jsx';
import Alerts from './pages/Alerts.jsx';
import AddNode from './pages/AddNode.jsx';
import Settings from './pages/Settings.jsx';

const NAV = [
    ['overview', '总览', IconOverview],
    ['alerts', '告警', IconAlert],
    ['add', '添加节点', IconAddNode],
    ['settings', '设置', IconSettings]
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

    // 权限/姓名实时同步：窗口获得焦点或每 3 分钟刷新一次，
    // 管理员调整名单后无需重新登录即可生效
    useEffect(() => {
        if (!session) return undefined;
        let cancelled = false;
        const sync = () => {
            api.get('/api/auth/me')
                .then((r) => {
                    if (!cancelled) setSession((prev) => (prev ? { ...prev, ...r } : r));
                })
                .catch(() => {});
        };
        const onFocus = () => sync();
        window.addEventListener('focus', onFocus);
        const timer = setInterval(sync, 3 * 60 * 1000);
        return () => {
            cancelled = true;
            window.removeEventListener('focus', onFocus);
            clearInterval(timer);
        };
    }, [Boolean(session)]);

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
                    {NAV.map(([key, label, Icon]) => (
                        <button
                            key={key}
                            className={`nav-item ${route.name === key || (key === 'overview' && route.name === 'node') ? 'is-active' : ''}`}
                            onClick={() => setRoute({ name: key })}
                            title={label}
                        >
                            <Icon className="nav-icon" />
                            <span className="nav-label">{label}</span>
                            {key === 'alerts' && stats.openAlerts > 0 && (
                                <span className="pill is-offline" style={{ marginLeft: 'auto' }}>
                                    {stats.openAlerts}
                                </span>
                            )}
                        </button>
                    ))}
                </nav>
                <div className="side-foot">
                    <button className="btn btn-sm theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                        {theme === 'dark' ? <IconSun /> : <IconMoon />}
                        {theme === 'dark' ? '切换浅色' : '切换深色'}
                    </button>
                    <div className="side-user">
                        <div className="side-user-info">
                            <div className="side-user-name">{session.name || session.email.split('@')[0]}</div>
                            <div className="side-user-mail" title={session.email}>
                                {session.email}
                            </div>
                        </div>
                        <button className="btn btn-sm btn-ghost logout-btn" onClick={logout} title="退出登录">
                            <IconLogout />
                            <span>退出</span>
                        </button>
                    </div>
                    <div className="side-version">v2.0.0 · {stats.online}/{stats.servers} 在线</div>
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
