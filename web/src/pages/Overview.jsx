import { api, fmtRate, fmtUptime, levelClass, timeAgo } from '../lib/api.js';
import Spark, { MetricLine, usePoll } from '../components/ui.jsx';

export default function Overview({ servers, stats, onOpen, refresh, toast }) {
    usePoll(refresh, 10000, []);

    const cards = servers.length
        ? servers
        : [
              {
                  id: 0,
                  hostname: '暂无节点',
                  status: 'offline',
                  latest: null
              }
          ];

    return (
        <>
            <div className="page-head">
                <div>
                    <h1 className="page-title">总览</h1>
                    <p className="page-sub">三台服务器的实时状态 · 每 10 秒刷新</p>
                </div>
                <div className="row">
                    <button className="btn btn-sm" onClick={() => refresh()}>
                        刷新
                    </button>
                </div>
            </div>

            <div className="grid grid-stats" style={{ marginBottom: 16 }}>
                <div className="card stat">
                    <span className="stat-value">
                        {stats.online}/{stats.servers}
                    </span>
                    <span className="stat-label">在线节点</span>
                </div>
                <div className="card stat">
                    <span className="stat-value" style={{ color: stats.openAlerts ? 'var(--bad)' : 'var(--ok)' }}>
                        {stats.openAlerts}
                    </span>
                    <span className="stat-label">未处理告警</span>
                </div>
                <div className="card stat">
                    <span className="stat-value" style={{ color: stats.pendingActions ? 'var(--warn)' : 'var(--ok)' }}>
                        {stats.pendingActions}
                    </span>
                    <span className="stat-label">待审批动作</span>
                </div>
                <div className="card stat">
                    <span className="stat-value">
                        {(stats.metricsCount || 0) >= 10000 ? `${Math.round((stats.metricsCount || 0) / 1000)}k` : stats.metricsCount || 0}
                    </span>
                    <span className="stat-label">已采集指标点</span>
                </div>
            </div>

            {servers.length === 0 && (
                <div className="empty">
                    还没有节点。
                    <br />
                    到「添加节点」生成一条安装命令，在目标服务器执行即可自动接入。
                </div>
            )}

            <div className="grid grid-nodes">
                {cards.map((s) => {
                    const m = s.latest;
                    const disk = m && m.disks ? m.disks.find((d) => d.mount === '/') || m.disks[0] : null;
                    return (
                        <div className="card node-card" key={s.id} style={{ cursor: s.id ? 'pointer' : 'default' }} onClick={() => s.id && onOpen(s.id)}>
                            <div className="node-head">
                                <div>
                                    <div className="node-name">{s.label || s.hostname}</div>
                                    <div className="node-meta">
                                        {s.os || '—'} · 心跳 {timeAgo(s.lastSeenAt)}
                                    </div>
                                </div>
                                <span className={`pill ${s.status === 'online' ? 'is-online' : 'is-offline'}`}>{s.status === 'online' ? '在线' : '离线'}</span>
                            </div>

                            {m ? (
                                <>
                                    <div className="node-spec">
                                        <span>
                                            运行 <b>{fmtUptime(m.uptimeSec)}</b>
                                        </span>
                                        <span>
                                            {m.cores ? <><b>{m.cores}</b> 核</> : null}
                                        </span>
                                        <span>
                                            流量 <b>{fmtRate(m.netRxRate)}</b> ↓ / <b>{fmtRate(m.netTxRate)}</b> ↑
                                        </span>
                                    </div>
                                    <MetricLine label="CPU" pct={m.cpu} valueText={`${Number(m.cpu).toFixed(0)}%`} />
                                    <MetricLine
                                        label="内存"
                                        pct={m.memPct}
                                        valueText={`${m.memUsedMb} / ${m.memTotalMb} MB`}
                                    />
                                    {disk && <MetricLine label={`磁盘`} pct={disk.pct} valueText={`${disk.usedMb} / ${disk.totalMb} MB`} />}
                                    <div className="row" style={{ justifyContent: 'space-between', fontSize: 12, color: 'var(--text-dim)' }}>
                                        <span>
                                            负载 <b style={{ color: 'var(--text)' }}>{Number(m.load1).toFixed(2)}</b>
                                        </span>
                                        <span>
                                            PM2 <b style={{ color: 'var(--text)' }}>{(m.pm2 || []).length}</b> 个
                                        </span>
                                        <span>
                                            systemd <b style={{ color: 'var(--text)' }}>{(m.systemd && m.systemd.runningCount) || 0}</b> 个
                                        </span>
                                    </div>
                                </>
                            ) : (
                                <div className="empty" style={{ padding: 14 }}>
                                    尚未收到上报（节点可能刚接入或处于离线）
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </>
    );
}
