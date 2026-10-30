import { useCallback, useEffect, useState } from 'react';
import { api, fmtTime } from '../lib/api.js';

export default function AddNode({ toast, session }) {
    const [tokens, setTokens] = useState([]);
    const [created, setCreated] = useState(null);
    const [ttl, setTtl] = useState(10);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        const r = await api.get('/api/install-tokens');
        setTokens(r.tokens || []);
    }, []);

    useEffect(() => {
        load().catch((e) => toast(e.message, 'bad'));
    }, [load, toast]);

    const create = async () => {
        setBusy(true);
        try {
            const master = window.location.origin;
            const r = await api.post('/api/install-tokens', { ttlMinutes: Number(ttl), master });
            setCreated(r);
            toast('安装命令已生成，10 分钟内有效', 'ok');
            await load();
        } catch (e) {
            toast(e.message, 'bad');
        } finally {
            setBusy(false);
        }
    };

    const copy = async (text) => {
        try {
            await navigator.clipboard.writeText(text);
            toast('已复制到剪贴板', 'ok');
        } catch {
            toast('复制失败，请手动选中复制', 'bad');
        }
    };

    return (
        <>
            <div className="page-head">
                <div>
                    <h1 className="page-title">添加节点</h1>
                    <p className="page-sub">生成一次性安装命令，在目标服务器用 root 执行即可自动接入</p>
                </div>
                <button className="btn btn-primary" onClick={create} disabled={busy}>
                    {busy ? '生成中…' : '生成安装命令'}
                </button>
            </div>

            <div className="card">
                <div className="card-head">
                    <div className="card-title">工作原理</div>
                </div>
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 2 }}>
                    <li>面板生成一次性 Token（默认 10 分钟有效，用过即失效）</li>
                    <li>把命令贴到新服务器执行：安装 Agent → 注册 → 自动启动 systemd 服务</li>
                    <li>Agent 只主动出站上报，不开放任何入站端口</li>
                    <li>远程操作走白名单 + 双人审批，全部写入审计</li>
                </ol>
            </div>

            {created && (
                <div className="card" style={{ marginTop: 14 }}>
                    <div className="card-head">
                        <div className="card-title">安装命令</div>
                        <span className="mono">有效期至 {fmtTime(created.expiresAt)}</span>
                    </div>
                    <pre className="pre">{created.command}</pre>
                    <div className="row" style={{ marginTop: 10 }}>
                        <button className="btn btn-primary" onClick={() => copy(created.command)}>
                            复制命令
                        </button>
                        <span className="mono">在该服务器上执行：sudo bash（命令已带 sudo）</span>
                    </div>
                </div>
            )}

            <div className="card" style={{ marginTop: 14 }}>
                <div className="card-head">
                    <div className="card-title">最近生成的令牌</div>
                    <div className="row">
                        <span className="mono">有效期（分钟）</span>
                        <input className="input" style={{ width: 90 }} value={ttl} onChange={(e) => setTtl(e.target.value)} inputMode="numeric" />
                    </div>
                </div>
                {tokens.length ? (
                    <table className="table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>创建人</th>
                                <th>创建时间</th>
                                <th>过期时间</th>
                                <th>状态</th>
                            </tr>
                        </thead>
                        <tbody>
                            {tokens.map((t) => (
                                <tr key={t.id}>
                                    <td className="mono">{t.id}</td>
                                    <td className="mono">{t.created_by}</td>
                                    <td className="mono">{fmtTime(t.created_at)}</td>
                                    <td className="mono">{fmtTime(t.expires_at)}</td>
                                    <td>
                                        {t.used_at ? (
                                            <span className="pill is-online">已使用（节点 #{t.used_server_id}）</span>
                                        ) : t.expires_at < Date.now() ? (
                                            <span className="pill is-offline">已过期</span>
                                        ) : (
                                            <span className="pill is-warn">待使用</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <div className="empty">还没有生成过令牌</div>
                )}
            </div>
        </>
    );
}
