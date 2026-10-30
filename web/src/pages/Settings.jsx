import { useCallback, useEffect, useState } from 'react';
import { api, fmtTime } from '../lib/api.js';
import { IconMail } from '../components/icons.jsx';

const ALERT_FIELDS = [
    ['alert.cpuPct', 'CPU 使用率阈值（%）', '85'],
    ['alert.memPct', '内存使用率阈值（%）', '90'],
    ['alert.diskPct', '磁盘使用率阈值（%）', '85'],
    ['alert.loadPerCore', '每核负载阈值', '2.5'],
    ['alert.offlineSeconds', '离线判定（秒）', '90'],
    ['alert.cooldownSeconds', '同类告警冷却（秒）', '600'],
    ['metric.retentionDays', '指标保留天数', '30'],
    ['metric.reportIntervalMs', '采集间隔（毫秒）', '10000']
];

const SMTP_FIELDS = [
    ['smtp.host', 'SMTP 主机', 'smtp.exmail.qq.com'],
    ['smtp.port', 'SMTP 端口', '465'],
    ['smtp.user', 'SMTP 账号', ''],
    ['smtp.pass', 'SMTP 密码', '******'],
    ['notify.emails', '告警收件人（逗号分隔）', '']
];

export default function Settings({ toast, session }) {
    const [settings, setSettings] = useState({});
    const [operators, setOperators] = useState([]);
    const [auditLog, setAuditLog] = useState([]);
    const [tab, setTab] = useState('alerts');
    const [busy, setBusy] = useState(false);
    const [newOp, setNewOp] = useState({ email: '', name: '', level: 1 });
    const [reportRecipients, setReportRecipients] = useState([]);
    const [extraRecipients, setExtraRecipients] = useState('');

    const load = useCallback(async () => {
        const [s, o, a] = await Promise.all([api.get('/api/settings'), api.get('/api/operators'), api.get('/api/audit?limit=100')]);
        const st = s.settings || {};
        setSettings(st);
        const saved = String(st['report.recipients'] || '')
            .split(/[,;\\s]+/)
            .map((x) => x.trim())
            .filter(Boolean);
        const known = new Set((o.operators || []).map((x) => x.email));
        setReportRecipients(saved.filter((e) => known.has(e)));
        setExtraRecipients(saved.filter((e) => !known.has(e)).join(','));
        setOperators(o.operators || []);
        setAuditLog(a.audit || []);
    }, []);

    useEffect(() => {
        load().catch((e) => toast(e.message, 'bad'));
    }, [load, toast]);

    const save = async (keys) => {
        setBusy(true);
        try {
            const patch = {};
            for (const k of keys) patch[k] = settings[k];
            await api.put('/api/settings', { settings: patch });
            toast('已保存', 'ok');
            await load();
        } catch (e) {
            toast(e.message, 'bad');
        } finally {
            setBusy(false);
        }
    };

    const addOperator = async () => {
        try {
            await api.post('/api/operators', newOp);
            toast('已添加运维', 'ok');
            setNewOp({ email: '', name: '', level: 1 });
            await load();
        } catch (e) {
            toast(e.message, 'bad');
        }
    };

    const removeOperator = async (id) => {
        try {
            await api.del(`/api/operators/${id}`);
            toast('已移除', 'ok');
            await load();
        } catch (e) {
            toast(e.message, 'bad');
        }
    };

    const isAdmin = session && session.level >= 2;

    return (
        <>
            <div className="page-head">
                <div>
                    <h1 className="page-title">设置</h1>
                    <p className="page-sub">告警阈值、邮件通知、运维人员与审计日志</p>
                </div>
                <div className="tabs">
                    {[
                        ['alerts', '告警与采集'],
                        ['smtp', '邮件通知'],
                        ['report', '定时日报'],
                        ['operators', '运维人员'],
                        ['audit', '审计日志']
                    ].map(([k, label]) => (
                        <button key={k} className={`tab ${tab === k ? 'is-active' : ''}`} onClick={() => setTab(k)}>
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {tab === 'alerts' && (
                <div className="card">
                    <div className="card-head">
                        <div className="card-title">告警与采集参数</div>
                        <button className="btn btn-primary btn-sm" disabled={busy || !isAdmin} onClick={() => save(ALERT_FIELDS.map((f) => f[0]))}>
                            保存
                        </button>
                    </div>
                    <div className="grid grid-2">
                        {ALERT_FIELDS.map(([key, label, ph]) => (
                            <div className="field" key={key}>
                                <label>{label}</label>
                                <input
                                    className="input"
                                    placeholder={ph}
                                    value={settings[key] ?? ''}
                                    disabled={!isAdmin}
                                    onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}
                                />
                            </div>
                        ))}
                    </div>
                    {!isAdmin && <p className="mono" style={{ marginTop: 10 }}>只读模式：仅管理员可修改</p>}
                </div>
            )}

            {tab === 'smtp' && (
                <div className="card">
                    <div className="card-head">
                        <div className="card-title">邮件通知（企业邮）</div>
                        <button className="btn btn-primary btn-sm" disabled={busy || !isAdmin} onClick={() => save(SMTP_FIELDS.map((f) => f[0]))}>
                            保存
                        </button>
                    </div>
                    <div className="grid grid-2">
                        {SMTP_FIELDS.map(([key, label, ph]) => (
                            <div className="field" key={key}>
                                <label>{label}</label>
                                <input
                                    className="input"
                                    type={key === 'smtp.pass' ? 'password' : 'text'}
                                    placeholder={ph}
                                    value={settings[key] ?? ''}
                                    disabled={!isAdmin}
                                    onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}
                                />
                            </div>
                        ))}
                    </div>
                    <p className="mono" style={{ marginTop: 10 }}>
                        密码保存后显示为 ******，留空不修改。当前邮件通道与官网站点共用企业邮账号。
                    </p>
                </div>
            )}

            {tab === 'operators' && (
                <>
                    <div className="card">
                        <div className="card-head">
                            <div className="card-title">添加运维</div>
                        </div>
                        <div className="row">
                            <input className="input" style={{ maxWidth: 240 }} placeholder="邮箱" value={newOp.email} onChange={(e) => setNewOp({ ...newOp, email: e.target.value })} />
                            <input className="input" style={{ maxWidth: 160 }} placeholder="姓名" value={newOp.name} onChange={(e) => setNewOp({ ...newOp, name: e.target.value })} />
                            <select className="select" style={{ maxWidth: 140 }} value={newOp.level} onChange={(e) => setNewOp({ ...newOp, level: Number(e.target.value) })}>
                                <option value={1}>只读运维</option>
                                <option value={2}>管理员</option>
                            </select>
                            <button className="btn btn-primary btn-sm" onClick={addOperator} disabled={!isAdmin}>
                                添加
                            </button>
                        </div>
                    </div>
                    <div className="card" style={{ marginTop: 14 }}>
                        <div className="card-head">
                            <div className="card-title">运维名单（{operators.length}）</div>
                        </div>
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>邮箱</th>
                                    <th>姓名</th>
                                    <th>权限</th>
                                    <th>加入时间</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {operators.map((o) => (
                                    <tr key={o.id}>
                                        <td className="mono">{o.email}</td>
                                        <td>{o.name || '—'}</td>
                                        <td>
                                            <span className={`pill ${o.level >= 2 ? 'is-online' : ''}`}>{o.level >= 2 ? '管理员' : '只读'}</span>
                                        </td>
                                        <td className="mono">{fmtTime(o.created_at)}</td>
                                        <td>
                                            <button className="btn btn-sm btn-danger" onClick={() => removeOperator(o.id)} disabled={!isAdmin}>
                                                移除
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {tab === 'report' && (
                <div className="card">
                    <div className="card-head">
                        <div className="card-title">
                            <IconMail className="title-icon" />
                            定时报告
                        </div>
                        <div className="row">
                            <button className="btn btn-sm" onClick={() => window.open('/api/report/preview-html', '_blank')}>
                                预览邮件
                            </button>
                            <button
                                className="btn btn-primary btn-sm"
                                disabled={busy || !isAdmin}
                                onClick={async () => {
                                    setBusy(true);
                                    try {
                                        await api.put('/api/settings', {
                                            settings: {
                                                'report.enabled': settings['report.enabled'] ?? '1',
                                                'report.frequency': settings['report.frequency'] ?? 'daily',
                                                'report.hour': settings['report.hour'] ?? '9',
                                                'report.weekday': settings['report.weekday'] ?? '1',
                                                'report.recipients': [...(reportRecipients || []), ...extraRecipients.split(/[,;\\s]+/).map((x) => x.trim()).filter((x) => x.includes('@'))].join(',')
                                            }
                                        });
                                        toast('报告设置已保存', 'ok');
                                        await load();
                                    } catch (e) {
                                        toast(e.message, 'bad');
                                    } finally {
                                        setBusy(false);
                                    }
                                }}
                            >
                                保存
                            </button>
                            <button
                                className="btn btn-sm"
                                disabled={!isAdmin}
                                onClick={async () => {
                                    try {
                                        const r = await api.post('/api/report/send', {});
                                        toast((r.weekly ? '周报' : '日报') + '已发送至 ' + (r.to || '收件人'), 'ok');
                                    } catch (e) {
                                        toast(e.message, 'bad');
                                    }
                                }}
                            >
                                立即发送一份
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-3">
                        <div className="field">
                            <label>启用</label>
                            <select
                                className="select"
                                value={settings['report.enabled'] ?? '1'}
                                disabled={!isAdmin}
                                onChange={(e) => setSettings({ ...settings, 'report.enabled': e.target.value })}
                            >
                                <option value="1">启用</option>
                                <option value="0">关闭</option>
                            </select>
                        </div>
                        <div className="field">
                            <label>发送频率</label>
                            <select
                                className="select"
                                value={settings['report.frequency'] ?? 'daily'}
                                disabled={!isAdmin}
                                onChange={(e) => setSettings({ ...settings, 'report.frequency': e.target.value })}
                            >
                                <option value="daily">每天（日报 · 近 24 小时）</option>
                                <option value="weekly">每周（周报 · 近 7 天）</option>
                            </select>
                        </div>
                        {(settings['report.frequency'] ?? 'daily') === 'weekly' && (
                            <div className="field">
                                <label>每周发送日</label>
                                <select
                                    className="select"
                                    value={settings['report.weekday'] ?? '1'}
                                    disabled={!isAdmin}
                                    onChange={(e) => setSettings({ ...settings, 'report.weekday': e.target.value })}
                                >
                                    {[
                                        ['1', '周一'],
                                        ['2', '周二'],
                                        ['3', '周三'],
                                        ['4', '周四'],
                                        ['5', '周五'],
                                        ['6', '周六'],
                                        ['7', '周日']
                                    ].map(([v, label]) => (
                                        <option key={v} value={v}>
                                            {label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <div className="field">
                            <label>发送时间</label>
                            <select
                                className="select"
                                value={settings['report.hour'] ?? '9'}
                                disabled={!isAdmin}
                                onChange={(e) => setSettings({ ...settings, 'report.hour': e.target.value })}
                            >
                                {Array.from({ length: 24 }, (_, i) => (
                                    <option key={i} value={String(i)}>
                                        {String(i).padStart(2, '0')}:00
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div style={{ marginTop: 16 }}>
                        <div className="field">
                            <label>收件人（勾选运维人员，可另加外部邮箱）</label>
                            <div className="recipient-list">
                                {(operators || []).map((o) => {
                                    const on = (reportRecipients || []).includes(o.email);
                                    return (
                                        <label key={o.email} className={`recipient-item ${on ? 'is-on' : ''}`}>
                                            <input
                                                type="checkbox"
                                                checked={on}
                                                disabled={!isAdmin}
                                                onChange={(e) => {
                                                    const cur = new Set(reportRecipients || []);
                                                    if (e.target.checked) cur.add(o.email);
                                                    else cur.delete(o.email);
                                                    setReportRecipients([...cur]);
                                                }}
                                            />
                                            <span className="recipient-name">{o.name || o.email.split('@')[0]}</span>
                                            <span className="recipient-mail">{o.email}</span>
                                        </label>
                                    );
                                })}
                            </div>
                            <div className="row" style={{ marginTop: 10 }}>
                                <input
                                    className="input"
                                    style={{ flex: 1, minWidth: 240 }}
                                    placeholder="额外收件人，多个用英文逗号分隔（可留空）"
                                    value={extraRecipients}
                                    disabled={!isAdmin}
                                    onChange={(e) => setExtraRecipients(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>

                    <p className="mono" style={{ marginTop: 12 }}>
                        日报内容：品牌化 HTML（节点卡片 + CPU/内存/磁盘进度条 + 近 24h 均值/峰值 + 未处理告警），
                        周报则统计近 7 天。当前收件人 {(reportRecipients || []).length} 个。
                    </p>
                </div>
            )}

            {tab === 'audit' && (
                <div className="card">
                    <div className="card-head">
                        <div className="card-title">审计日志（最近 100 条）</div>
                    </div>
                    {auditLog.length ? (
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>时间</th>
                                    <th>操作者</th>
                                    <th>动作</th>
                                    <th>目标</th>
                                    <th>详情</th>
                                </tr>
                            </thead>
                            <tbody>
                                {auditLog.map((a) => (
                                    <tr key={a.id}>
                                        <td className="mono">{fmtTime(a.created_at)}</td>
                                        <td className="mono">{a.actor}</td>
                                        <td>{a.action}</td>
                                        <td className="mono">{a.target}</td>
                                        <td className="mono" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {a.detail}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <div className="empty">暂无审计记录</div>
                    )}
                </div>
            )}
        </>
    );
}
