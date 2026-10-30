import { useCallback, useEffect, useState } from 'react';
import { api, fmtRate, fmtTime, fmtUptime, timeAgo } from '../lib/api.js';
import Spark, { MetricLine } from '../components/ui.jsx';

const ACTION_TYPES = [
    { type: 'service.restart', label: '重启 systemd 服务', params: [{ k: 'unit', label: '单元名', placeholder: 'nginx' }] },
    { type: 'pm2.restart', label: '重启 PM2 进程', params: [{ k: 'name', label: '进程名', placeholder: 'xuanjian-guild' }] },
    { type: 'log.tail', label: '查看日志尾部', params: [{ k: 'path', label: '日志路径', placeholder: '/var/log/nginx/error.log' }, { k: 'lines', label: '行数', placeholder: '100' }] },
    { type: 'disk.cleanup', label: '清理旧文件', params: [{ k: 'target', label: '目录（以 / 结尾）', placeholder: '/opt/minecraft-backups/' }, { k: 'keepDays', label: '保留天数', placeholder: '3' }] },
    { type: 'system.info', label: '系统概览（uptime/df/free）', params: [] }
];

export default function NodeDetail({ id, onBack, toast, session }) {
    const [server, setServer] = useState(null);
    const [metrics, setMetrics] = useState(null);
    const [points, setPoints] = useState([]);
    const [actions, setActions] = useState([]);
    const [hours, setHours] = useState(24);
    const [tab, setTab] = useState('overview');
    const [form, setForm] = useState({ type: 'service.restart', params: {}, reason: '' });
    const [busy, setBusy] = useState(false);
    const [output, setOutput] = useState('');

    const load = useCallback(async () => {
        const [d, mt, a] = await Promise.all([
            api.get(`/api/servers/${id}/detail`),
            api.get(`/api/servers/${id}/metrics?hours=${hours}`),
            api.get('/api/actions?limit=50')
        ]);
        setServer(d.server);
        setMetrics(d.metrics);
        setPoints(mt.points || []);
        setActions((a.actions || []).filter((x) => x.server_id === Number(id)));
    }, [id, hours]);

    useEffect(() => {
        load().catch((e) => toast(e.message, 'bad'));
        const t = setInterval(() => load().catch(() => {}), 10000);
        return () => clearInterval(t);
    }, [load, toast]);

    const submitAction = async () => {
        setBusy(true);
        try {
            const params = { ...form.params };
            if (params.lines) params.lines = Number(params.lines);
            if (params.keepDays) params.keepDays = Number(params.keepDays);
            await api.post('/api/actions', { serverId: Number(id), type: form.type, params, reason: form.reason });
            toast('已提交，等待审批', 'ok');
            setForm({ ...form, reason: '' });
            await load();
        } catch (e) {
            toast(e.message, 'bad');
        } finally {
            setBusy(false);
        }
    };

    const approve = async (aid) => {
        try {
            await api.post(`/api/actions/${aid}/approve`);
            toast('已批准，Agent 将在下次心跳执行', 'ok');
            await load();
        } catch (e) {
            toast(e.message, 'bad');
        }
    };
    const reject = async (aid) => {
        try {
            await api.post(`/api/actions/${aid}/reject`);
            toast('已驳回', 'ok');
            await load();
        } catch (e) {
            toast(e.message, 'bad');
        }
    };

    const viewOutput = async (a) => {
        setOutput(`#${a.id} ${a.type}\n${a.output || a.error || '（暂无输出）'}`);
    };

    if (!server) return <div className="empty">加载中…</div>;

    const m = metrics || {};
    const diskRoot = (m.disks || []).find((d) => d.mount === '/') || (m.disks || [])[0];
    const cpuSeries = points.map((p) => p.cpu);
    const memSeries = points.map((p) => p.mem_pct);
    const loadSeries = points.map((p) => p.load1);
    const netSeries = points.map((p) => (p.net_rx_rate || 0) / 1024);

    const currentAction = ACTION_TYPES.find((a) => a.type === form.type) || ACTION_TYPES[0];

    return (
        <>
            <div className="page-head">
                <div>
                    <h1 className="page-title">
                        {server.label || server.hostname}
                        <button
                            className="btn btn-sm"
                            style={{ marginLeft: 10, verticalAlign: 'middle' }}
                            onClick={async () => {
                                const next = window.prompt('给该节点起个名字（留空则用主机名）', server.label || '');
                                if (next === null) return;
                                try {
                                    await api.patch(`/api/servers/${id}`, { label: next.trim() });
                                    toast('已更新节点名称', 'ok');
                                    await load();
                                } catch (e) {
                                    toast(e.message, 'bad');
                                }
                            }}
                        >
                            重命名
                        </button>
                    </h1>
                    <p className="page-sub">
                        {server.os} · {m.os ? m.os.kernel : ''} · 心跳 {timeAgo(server.last_seen_at)} · Agent {server.agent_version || '—'}
                    </p>
                </div>
                <div className="row">
                    <div className="tabs">
                        {[
                            ['overview', '概览'],
                            ['procs', '进程'],
                            ['services', '服务'],
                            ['actions', '远程操作']
                        ].map(([k, label]) => (
                            <button key={k} className={`tab ${tab === k ? 'is-active' : ''}`} onClick={() => setTab(k)}>
                                {label}
                            </button>
                        ))}
                    </div>
                    <button className="btn btn-sm" onClick={onBack}>
                        返回
                    </button>
                </div>
            </div>

            {tab === 'overview' && (
                <>
                    <div className="grid grid-2">
                        <div className="card">
                            <div className="card-head">
                                <div className="card-title">CPU 使用率</div>
                                <span className="mono">{points.length} 点 / {hours}h</span>
                            </div>
                            <Spark points={cpuSeries} />
                            <MetricLine label="当前" pct={m.cpu && m.cpu.usage} valueText={`${Number((m.cpu && m.cpu.usage) || 0).toFixed(0)}%`} />
                            <div className="node-spec" style={{ marginTop: 8 }}>
                                <span>
                                    负载 <b>{Number((m.load && m.load.load1) || 0).toFixed(2)}</b> / {Number((m.load && m.load.load5) || 0).toFixed(2)} /{' '}
                                    {Number((m.load && m.load.load15) || 0).toFixed(2)}
                                </span>
                                <span>
                                    核心 <b>{(m.cpu && m.cpu.cores) || '—'}</b>
                                </span>
                                <span>
                                    运行 <b>{fmtUptime(m.uptimeSec)}</b>
                                </span>
                            </div>
                        </div>

                        <div className="card">
                            <div className="card-head">
                                <div className="card-title">内存</div>
                                <span className="mono">{m.mem ? `${m.mem.usedMb}/${m.mem.totalMb} MB` : '—'}</span>
                            </div>
                            <Spark points={memSeries} color="var(--ok)" />
                            <MetricLine label="使用" pct={m.mem && m.mem.pct} valueText={`${Number((m.mem && m.mem.pct) || 0).toFixed(0)}%`} />
                            {m.mem && m.mem.swapTotalMb > 0 && (
                                <div className="node-spec" style={{ marginTop: 6 }}>
                                    <span>
                                        Swap <b>{m.mem.swapTotalMb - m.mem.swapFreeMb}</b> / {m.mem.swapTotalMb} MB
                                    </span>
                                </div>
                            )}
                        </div>

                        <div className="card">
                            <div className="card-head">
                                <div className="card-title">磁盘</div>
                                <span className="mono">{(m.disks || []).length} 个挂载点</span>
                            </div>
                            {(m.disks || []).map((d) => (
                                <MetricLine key={d.mount} label={d.mount} pct={d.pct} valueText={`${d.usedMb} / ${d.totalMb} MB`} />
                            ))}
                            {!(m.disks || []).length && <div className="empty" style={{ padding: 12 }}>无数据</div>}
                        </div>

                        <div className="card">
                            <div className="card-head">
                                <div className="card-title">网络</div>
                                <span className="mono">KB/s</span>
                            </div>
                            <Spark points={netSeries} color="var(--warn)" max={Math.max(64, ...netSeries)} />
                            <div className="node-spec" style={{ marginTop: 8 }}>
                                <span>
                                    ↓ <b>{fmtRate(m.net && m.net.rxRate)}</b>
                                </span>
                                <span>
                                    ↑ <b>{fmtRate(m.net && m.net.txRate)}</b>
                                </span>
                                <span>
                                    累计 ↓ <b>{fmtRate(m.net && m.net.rxBytes)}</b> / ↑ <b>{fmtRate(m.net && m.net.txBytes)}</b>
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="card" style={{ marginTop: 14 }}>
                        <div className="card-head">
                            <div className="card-title">时间区间</div>
                        </div>
                        <div className="row">
                            {[1, 6, 12, 24, 72, 168, 720].map((h) => (
                                <button key={h} className={`btn btn-sm ${hours === h ? 'btn-primary' : ''}`} onClick={() => setHours(h)}>
                                    {h < 24 ? `${h} 小时` : `${h / 24} 天`}
                                </button>
                            ))}
                        </div>
                    </div>
                </>
            )}

            {tab === 'procs' && (
                <>
                    <div className="card">
                        <div className="card-head">
                            <div className="card-title">PM2 进程（{(m.pm2 || []).length}）</div>
                        </div>
                        {(m.pm2 || []).length ? (
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>名称</th>
                                        <th>状态</th>
                                        <th>重启</th>
                                        <th>CPU</th>
                                        <th>内存</th>
                                        <th>运行</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(m.pm2 || []).map((p) => (
                                        <tr key={p.name}>
                                            <td>{p.name}</td>
                                            <td>
                                                <span className={`pill ${p.status === 'online' ? 'is-online' : 'is-offline'}`}>{p.status}</span>
                                            </td>
                                            <td>{p.restarts}</td>
                                            <td>{p.cpu}%</td>
                                            <td>{p.memMb} MB</td>
                                            <td className="mono">{fmtUptime(p.uptimeSec)}</td>
                                            <td>
                                                <button
                                                    className="btn btn-sm"
                                                    onClick={() => {
                                                        setTab('actions');
                                                        setForm({ type: 'pm2.restart', params: { name: p.name }, reason: '' });
                                                    }}
                                                >
                                                    重启
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <div className="empty">该节点无 PM2 或未安装</div>
                        )}
                    </div>

                    <div className="card" style={{ marginTop: 14 }}>
                        <div className="card-head">
                            <div className="card-title">CPU 占用 Top（{(m.procs || []).length}）</div>
                        </div>
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>PID</th>
                                    <th>进程</th>
                                    <th>CPU</th>
                                    <th>内存</th>
                                    <th>RSS</th>
                                    <th>运行时长</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(m.procs || []).map((p) => (
                                    <tr key={p.pid}>
                                        <td className="mono">{p.pid}</td>
                                        <td>{p.name}</td>
                                        <td>{p.cpu}%</td>
                                        <td>{p.mem}%</td>
                                        <td>{p.rssMb} MB</td>
                                        <td className="mono">{p.etime}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {tab === 'services' && (
                <>
                    <div className="card">
                        <div className="card-head">
                            <div className="card-title">systemd 运行中（{(m.systemd && m.systemd.runningCount) || 0}）</div>
                        </div>
                        <div className="row" style={{ gap: 6 }}>
                            {((m.systemd && m.systemd.running) || []).map((u) => (
                                <span className="mono" key={u} style={{ padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 6 }}>
                                    {u}
                                </span>
                            ))}
                        </div>
                    </div>
                    <div className="card" style={{ marginTop: 14 }}>
                        <div className="card-head">
                            <div className="card-title">失败服务（{((m.systemd && m.systemd.failed) || []).length}）</div>
                        </div>
                        {((m.systemd && m.systemd.failed) || []).length ? (
                            <div className="row" style={{ gap: 6 }}>
                                {m.systemd.failed.map((u) => (
                                    <span className="pill is-offline" key={u}>
                                        {u}
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <div className="empty" style={{ padding: 12 }}>没有失败的服务</div>
                        )}
                    </div>
                    <div className="card" style={{ marginTop: 14 }}>
                        <div className="card-head">
                            <div className="card-title">Fail2ban</div>
                        </div>
                        {m.fail2ban && m.fail2ban.installed ? (
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Jail</th>
                                        <th>当前封禁</th>
                                        <th>累计封禁</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(m.fail2ban.jails || []).map((j) => (
                                        <tr key={j.name}>
                                            <td>{j.name}</td>
                                            <td>{j.currentlyBanned}</td>
                                            <td>{j.totalBanned}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <div className="empty" style={{ padding: 12 }}>未安装 fail2ban</div>
                        )}
                    </div>
                </>
            )}

            {tab === 'actions' && (
                <>
                    <div className="card">
                        <div className="card-head">
                            <div className="card-title">发起远程操作</div>
                            <span className="mono">白名单执行 · 需审批</span>
                        </div>
                        <div className="grid grid-2">
                            <div className="field">
                                <label>动作类型</label>
                                <select className="select" value={form.type} onChange={(e) => setForm({ type: e.target.value, params: {}, reason: form.reason })}>
                                    {ACTION_TYPES.map((a) => (
                                        <option key={a.type} value={a.type}>
                                            {a.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            {currentAction.params.map((p) => (
                                <div className="field" key={p.k}>
                                    <label>{p.label}</label>
                                    <input
                                        className="input"
                                        placeholder={p.placeholder || ''}
                                        value={form.params[p.k] || ''}
                                        onChange={(e) => setForm({ ...form, params: { ...form.params, [p.k]: e.target.value } })}
                                    />
                                </div>
                            ))}
                            <div className="field" style={{ gridColumn: '1 / -1' }}>
                                <label>原因（会写进审计）</label>
                                <input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
                            </div>
                        </div>
                        <div className="row" style={{ marginTop: 12 }}>
                            <button className="btn btn-primary" onClick={submitAction} disabled={busy}>
                                提交申请
                            </button>
                        </div>
                    </div>

                    <div className="card" style={{ marginTop: 14 }}>
                        <div className="card-head">
                            <div className="card-title">动作记录</div>
                        </div>
                        {actions.length ? (
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>类型</th>
                                        <th>状态</th>
                                        <th>申请人</th>
                                        <th>时间</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {actions.map((a) => (
                                        <tr key={a.id}>
                                            <td className="mono">{a.id}</td>
                                            <td>{a.type}</td>
                                            <td>
                                                <span className={`pill ${a.status === 'done' ? 'is-online' : a.status === 'failed' || a.status === 'rejected' ? 'is-offline' : 'is-warn'}`}>
                                                    {a.status}
                                                </span>
                                            </td>
                                            <td className="mono">{a.requested_by}</td>
                                            <td className="mono">{fmtTime(a.created_at)}</td>
                                            <td>
                                                <div className="row" style={{ gap: 6 }}>
                                                    {a.status === 'pending' && (
                                                        <>
                                                            <button className="btn btn-sm btn-primary" onClick={() => approve(a.id)}>
                                                                批准
                                                            </button>
                                                            <button className="btn btn-sm btn-danger" onClick={() => reject(a.id)}>
                                                                驳回
                                                            </button>
                                                        </>
                                                    )}
                                                    {(a.output || a.error) && (
                                                        <button className="btn btn-sm" onClick={() => viewOutput(a)}>
                                                            输出
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <div className="empty">暂无操作记录</div>
                        )}
                        {output && <pre className="pre">{output}</pre>}
                    </div>
                </>
            )}
        </>
    );
}
