import { useCallback, useEffect, useState } from 'react';
import { api, fmtTime, timeAgo } from '../lib/api.js';

export default function Alerts({ toast }) {
    const [status, setStatus] = useState('open');
    const [alerts, setAlerts] = useState([]);

    const load = useCallback(async () => {
        const r = await api.get(`/api/alerts?status=${status}&limit=200`);
        setAlerts(r.alerts || []);
    }, [status]);

    useEffect(() => {
        load().catch((e) => toast(e.message, 'bad'));
    }, [load, toast]);

    const resolve = async (id) => {
        try {
            await api.post(`/api/alerts/${id}/resolve`);
            toast('已标记为已处理', 'ok');
            await load();
        } catch (e) {
            toast(e.message, 'bad');
        }
    };

    return (
        <>
            <div className="page-head">
                <div>
                    <h1 className="page-title">告警</h1>
                    <p className="page-sub">阈值触发后自动发邮件；处理完可手动关闭</p>
                </div>
                <div className="tabs">
                    {[
                        ['open', '未处理'],
                        ['resolved', '已处理'],
                        ['all', '全部']
                    ].map(([k, label]) => (
                        <button key={k} className={`tab ${status === k ? 'is-active' : ''}`} onClick={() => setStatus(k)}>
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="card">
                {alerts.length ? (
                    <table className="table">
                        <thead>
                            <tr>
                                <th>节点</th>
                                <th>级别</th>
                                <th>内容</th>
                                <th>触发时间</th>
                                <th>状态</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {alerts.map((a) => (
                                <tr key={a.id}>
                                    <td>{a.server ? a.server.label || a.server.hostname : '#' + a.server_id}</td>
                                    <td>
                                        <span className={`pill ${a.level === 'error' ? 'is-offline' : 'is-warn'}`}>{a.level}</span>
                                    </td>
                                    <td>{a.message}</td>
                                    <td className="mono">{timeAgo(a.created_at)}</td>
                                    <td>
                                        <span className={`pill ${a.status === 'open' ? 'is-warn' : 'is-online'}`}>{a.status === 'open' ? '未处理' : '已处理'}</span>
                                    </td>
                                    <td>
                                        {a.status === 'open' && (
                                            <button className="btn btn-sm" onClick={() => resolve(a.id)}>
                                                标记已处理
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <div className="empty">没有{status === 'open' ? '未处理的' : '相关'}告警</div>
                )}
            </div>
        </>
    );
}
