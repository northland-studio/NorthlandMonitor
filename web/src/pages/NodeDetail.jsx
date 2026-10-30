import { useCallback, useEffect, useState } from 'react';
import { api, fmtRate, fmtTime, fmtUptime, timeAgo } from '../lib/api.js';
import Spark, { MetricLine } from '../components/ui.jsx';

const ACTION_TYPES = [
    { type: 'service.restart', label: '重启 systemd 服务', params: [{ k: 'unit', label: '单元名', placeholder: 'nginx' }] },
    { type: 'pm2.restart', label: '重启 PM2 进程', params: [{ k: 'name', label: '进程名', placeholder: 'xuanjian-guild' }] },
    { type: 'log.tail', label: '查看日志尾部', params: [{ k: 'path', label: '日志路径', placeholder: '/var/log/nginx/error.log' }, { k: 'lines', label: '行数', placeholder: '100' }] },
    { type: 'fail2ban.ban', label: 'Fail2ban 封禁 IP', params: [{ k: 'jail', label: 'Jail 名称', placeholder: 'sshd' }, { k: 'ip', label: 'IP 地址', placeholder: '1.2.3.4' }] },
    { type: 'fail2ban.unban', label: 'Fail2ban 解封 IP', params: [{ k: 'jail', label: 'Jail 名称', placeholder: 'sshd' }, { k: 'ip', label: 'IP 地址', placeholder: '1.2.3.4' }] },
    { type: 'disk.cleanup', label: '清理旧文件', params: [{ k: 'target', label: '目录（以 / 结尾）', placeholder: '/opt/minecraft-backups/' }, { k: 'keepDays', label: '保留天数', placeholder: '3' }] },
    { type: 'system.info', label: '系统概览（uptime/df/free）', params: [] }
];

const READONLY = new Set(['log.tail', 'log.list', 'system.info', 'file.list', 'file.read', 'file.download']);

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
    const [logFiles, setLogFiles] = useState([]);
    const [logPath, setLogPath] = useState('');
    const [logText, setLogText] = useState('');
    const [logBusy, setLogBusy] = useState(false);
    const [f2bForm, setF2bForm] = useState({ jail: '', ip: '' });
    const [filePath, setFilePath] = useState('/var/www');
    const [fileEntries, setFileEntries] = useState([]);
    const [fileParent, setFileParent] = useState('/');
    const [fileContent, setFileContent] = useState('');
    const [fileName, setFileName] = useState('');
    const [fileBusy, setFileBusy] = useState(false);

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

    /** 提交只读动作并等待 Agent 执行结果（最多 25 秒） */
    const runReadonly = async (type, params) => {
        const r = await api.post('/api/actions', { serverId: Number(id), type, params });
        for (let i = 0; i < 25; i++) {
            await new Promise((res) => setTimeout(res, 1000));
            const a = await api.get(`/api/actions/${r.id}`);
            const st = a.action && a.action.status;
            if (st === 'done') return a.action.output || '';
            if (st === 'failed') throw new Error(a.action.error || '执行失败');
            if (st === 'pending' || st === 'approved' || st === 'running') continue;
            break;
        }
        throw new Error('等待 Agent 超时（节点可能离线）');
    };

    const loadLogFiles = async () => {
        setLogBusy(true);
        try {
            const text = await runReadonly('log.list', {});
            const list = JSON.parse(text || '[]');
            setLogFiles(list);
            if (!logPath && list.length) setLogPath(list[0].path);
            toast(`已获取 ${list.length} 个日志文件`, 'ok');
        } catch (e) {
            toast(e.message, 'bad');
        } finally {
            setLogBusy(false);
        }
    };

    const openLog = async (path, lines = 200) => {
        setLogPath(path);
        setLogBusy(true);
        setLogText('加载中…');
        try {
            const text = await runReadonly('log.tail', { path, lines });
            setLogText(text);
        } catch (e) {
            setLogText('读取失败：' + e.message);
        } finally {
            setLogBusy(false);
        }
    };

    const submitAction = async () => {
        setBusy(true);
        try {
            const params = { ...form.params };
            if (params.lines) params.lines = Number(params.lines);
            if (params.keepDays) params.keepDays = Number(params.keepDays);
            const auto = READONLY.has(form.type);
            await api.post('/api/actions', { serverId: Number(id), type: form.type, params, reason: form.reason });
            toast(auto ? '已提交并自动执行' : '已提交，等待审批', 'ok');
            setForm({ ...form, reason: '' });
            await load();
        } catch (e) {
            toast(e.message, 'bad');
        } finally {
            setBusy(false);
        }
    };

    const submitF2b = async (type) => {
        if (!f2bForm.jail || !f2bForm.ip) return toast('请填写 jail 与 IP', 'bad');
        try {
            await api.post('/api/actions', {
                serverId: Number(id),
                type,
                params: { jail: f2bForm.jail, ip: f2bForm.ip },
                reason: 'Fail2ban 手动操作'
            });
            toast(type === 'fail2ban.ban' ? '封禁申请已提交，等待审批' : '解封申请已提交，等待审批', 'ok');
            await load();
        } catch (e) {
            toast(e.message, 'bad');
        }
    };

    /* ---------------- 文件管理 ---------------- */

    const loadFiles = async (target) => {
        const dir = target || filePath;
        setFileBusy(true);
        try {
            const text = await runReadonly('file.list', { path: dir });
            const data = JSON.parse(text || '{}');
            if (data.error) throw new Error(data.error);
            setFilePath(data.path);
            setFileParent(data.parent || '/');
            setFileEntries(data.entries || []);
        } catch (e) {
            toast(e.message, 'bad');
        } finally {
            setFileBusy(false);
        }
    };

    const openFile = async (p) => {
        setFileBusy(true);
        setFileName(p);
        setFileContent('加载中…');
        try {
            const text = await runReadonly('file.read', { path: p });
            if (text.startsWith('__BINARY__:')) setFileContent('（二进制文件，请用「下载」按钮获取）');
            else setFileContent(text || '（空文件）');
        } catch (e) {
            setFileContent('读取失败：' + e.message);
        } finally {
            setFileBusy(false);
        }
    };

    const downloadFile = async (p) => {
        setFileBusy(true);
        try {
            const text = await runReadonly('file.download', { path: p });
            const data = JSON.parse(text || '{}');
            if (data.error) throw new Error(data.error);
            const bin = atob(data.base64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const blob = new Blob([bytes]);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = data.name || 'download';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
            toast(`已开始下载 ${data.name}（${(data.size / 1024).toFixed(0)} KB）`, 'ok');
        } catch (e) {
            toast(e.message, 'bad');
        } finally {
            setFileBusy(false);
        }
    };

    const fmtSize = (n) => {
        n = Number(n) || 0;
        if (n < 1024) return n + ' B';
        if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
        return (n / 1048576).toFixed(1) + ' MB';
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
                            ['logs', '日志'],
                            ['files', '文件'],
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
                            <span className="mono">封禁 / 解封需审批</span>
                        </div>
                        {m.fail2ban && m.fail2ban.installed ? (
                            <>
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th>Jail</th>
                                            <th>当前封禁</th>
                                            <th>累计封禁</th>
                                            <th>封禁 IP（最近）</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(m.fail2ban.jails || []).map((j) => (
                                            <tr key={j.name}>
                                                <td>{j.name}</td>
                                                <td>{j.currentlyBanned}</td>
                                                <td>{j.totalBanned}</td>
                                                <td className="mono">
                                                    {(j.bannedIps || []).length
                                                        ? j.bannedIps.map((ip) => (
                                                              <button
                                                                  key={ip}
                                                                  className="btn btn-sm"
                                                                  style={{ marginRight: 4, marginBottom: 4, padding: '2px 7px' }}
                                                                  title="点击解封该 IP"
                                                                  onClick={() => {
                                                                      setF2bForm({ jail: j.name, ip });
                                                                      submitF2b('fail2ban.unban');
                                                                  }}
                                                              >
                                                                  {ip}
                                                              </button>
                                                          ))
                                                        : '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <div className="row" style={{ marginTop: 12 }}>
                                    <input
                                        className="input"
                                        style={{ maxWidth: 150 }}
                                        placeholder="jail（如 sshd）"
                                        value={f2bForm.jail}
                                        onChange={(e) => setF2bForm({ ...f2bForm, jail: e.target.value })}
                                    />
                                    <input
                                        className="input"
                                        style={{ maxWidth: 190 }}
                                        placeholder="IP 地址"
                                        value={f2bForm.ip}
                                        onChange={(e) => setF2bForm({ ...f2bForm, ip: e.target.value })}
                                    />
                                    <button className="btn btn-sm btn-danger" onClick={() => submitF2b('fail2ban.ban')}>
                                        封禁
                                    </button>
                                    <button className="btn btn-sm" onClick={() => submitF2b('fail2ban.unban')}>
                                        解封
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div className="empty" style={{ padding: 12 }}>未安装 fail2ban</div>
                        )}
                    </div>
                </>
            )}

            {tab === 'logs' && (
                <>
                    <div className="card">
                        <div className="card-head">
                            <div className="card-title">日志文件</div>
                            <button className="btn btn-sm btn-primary" onClick={loadLogFiles} disabled={logBusy}>
                                {logBusy ? '获取中…' : '刷新列表'}
                            </button>
                        </div>
                        {logFiles.length ? (
                            <div className="row" style={{ gap: 6 }}>
                                {logFiles.map((f) => (
                                    <button
                                        key={f.path}
                                        className={`btn btn-sm ${logPath === f.path ? 'btn-primary' : ''}`}
                                        title={`${f.path}\n${(f.size / 1024).toFixed(0)} KB`}
                                        onClick={() => openLog(f.path, 200)}
                                    >
                                        {f.path.split('/').pop()} <span className="mono">{f.group}</span>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="empty" style={{ padding: 12 }}>
                                点击「刷新列表」从节点读取可查看的日志（自动执行，无需审批）
                            </div>
                        )}
                    </div>
                    <div className="card" style={{ marginTop: 14 }}>
                        <div className="card-head">
                            <div className="card-title">{logPath || '日志内容'}</div>
                            <div className="row">
                                {[100, 200, 500].map((n) => (
                                    <button key={n} className="btn btn-sm" disabled={!logPath || logBusy} onClick={() => openLog(logPath, n)}>
                                        {n} 行
                                    </button>
                                ))}
                            </div>
                        </div>
                        <pre className="pre">{logText || '（选择上方的日志文件查看内容）'}</pre>
                    </div>
                </>
            )}

            {tab === 'files' && (
                <>
                    <div className="card">
                        <div className="card-head">
                            <div className="card-title">文件管理</div>
                            <span className="mono">只读 · 白名单目录（/var/www /var/log /opt /root /etc/nginx /srv /home /tmp）</span>
                        </div>
                        <div className="row" style={{ marginBottom: 10 }}>
                            <input className="input" style={{ flex: 1, minWidth: 220 }} value={filePath} onChange={(e) => setFilePath(e.target.value)} />
                            <button className="btn btn-sm" onClick={() => loadFiles(filePath)} disabled={fileBusy}>
                                {fileBusy ? '读取中…' : '打开'}
                            </button>
                            <button className="btn btn-sm" onClick={() => loadFiles(fileParent)} disabled={fileBusy || !fileParent}>
                                上级目录
                            </button>
                            <button className="btn btn-sm btn-primary" onClick={() => loadFiles('/var/www')} disabled={fileBusy}>
                                站点根目录
                            </button>
                        </div>
                        {fileEntries.length ? (
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>名称</th>
                                        <th>类型</th>
                                        <th>大小</th>
                                        <th>修改时间</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {fileEntries.map((f) => (
                                        <tr key={f.path}>
                                            <td>
                                                {f.isDir ? (
                                                    <button className="btn btn-sm" style={{ border: 'none', background: 'transparent', padding: 0, color: 'var(--primary)' }} onClick={() => loadFiles(f.path)}>
                                                        目录 {f.name}
                                                    </button>
                                                ) : (
                                                    f.name
                                                )}
                                                {f.isLink && <span className="mono"> （软链）</span>}
                                            </td>
                                            <td className="mono">{f.isDir ? '目录' : '文件'}</td>
                                            <td className="mono">{f.isDir ? '—' : fmtSize(f.size)}</td>
                                            <td className="mono">{f.mtime ? fmtTime(f.mtime) : '—'}</td>
                                            <td>
                                                {!f.isDir && (
                                                    <div className="row" style={{ gap: 6 }}>
                                                        <button className="btn btn-sm" onClick={() => openFile(f.path)} disabled={fileBusy}>
                                                            查看
                                                        </button>
                                                        <button className="btn btn-sm" onClick={() => downloadFile(f.path)} disabled={fileBusy}>
                                                            下载
                                                        </button>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <div className="empty" style={{ padding: 14 }}>
                                输入路径后点「打开」即可浏览节点文件（无需审批）
                            </div>
                        )}
                    </div>
                    <div className="card" style={{ marginTop: 14 }}>
                        <div className="card-head">
                            <div className="card-title">{fileName || '文件内容'}</div>
                            {fileName && (
                                <button className="btn btn-sm" onClick={() => downloadFile(fileName)} disabled={fileBusy}>
                                    下载
                                </button>
                            )}
                        </div>
                        <pre className="pre">{fileContent || '（选择文件后点「查看」）'}</pre>
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
