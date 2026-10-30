import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function Login({ onLogin, toast }) {
    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [step, setStep] = useState('email');
    const [busy, setBusy] = useState(false);
    const [countdown, setCountdown] = useState(0);

    useEffect(() => {
        if (countdown <= 0) return undefined;
        const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
        return () => clearTimeout(t);
    }, [countdown]);

    const sendCode = async () => {
        if (!email.trim()) return toast('请输入邮箱', 'bad');
        setBusy(true);
        try {
            const r = await api.post('/api/auth/send-code', { email: email.trim() });
            if (r.fallback) toast('SMTP 未配置，验证码已输出到服务端日志', 'ok');
            else toast('验证码已发送，请查收邮件', 'ok');
            setStep('code');
            setCountdown(60);
        } catch (e) {
            toast(e.message, 'bad');
        } finally {
            setBusy(false);
        }
    };

    const login = async () => {
        if (!code.trim()) return toast('请输入验证码', 'bad');
        setBusy(true);
        try {
            const r = await api.post('/api/auth/login', { email: email.trim(), code: code.trim() });
            toast('登录成功', 'ok');
            onLogin(r);
        } catch (e) {
            toast(e.message, 'bad');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="login-wrap">
            <div className="login-bg" aria-hidden="true" />
            <div className="login-card">
                <div className="login-brand">
                    <img className="login-logo" src="/logo.png" alt="北域工作室 Northland Studio" />
                    <div>
                        <div className="login-brand-cn">北域工作室</div>
                        <div className="login-brand-en">Northland Studio</div>
                    </div>
                </div>
                <h1 className="login-title">运维登录</h1>
                <p className="login-sub">服务器统一监控面板 · 仅限已登记的运维邮箱，验证码 10 分钟内有效</p>
                <div className="form-stack">
                    <div className="field">
                        <label>运维邮箱</label>
                        <input
                            className="input"
                            type="email"
                            placeholder="northland@xuanjian.top"
                            value={email}
                            autoComplete="username"
                            onChange={(e) => setEmail(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && step === 'email' && sendCode()}
                        />
                    </div>
                    {step === 'code' && (
                        <div className="field">
                            <label>邮箱验证码</label>
                            <input
                                className="input"
                                inputMode="numeric"
                                placeholder="6 位数字"
                                value={code}
                                autoComplete="one-time-code"
                                onChange={(e) => setCode(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && login()}
                            />
                        </div>
                    )}
                    {step === 'email' ? (
                        <button className="btn btn-primary" onClick={sendCode} disabled={busy}>
                            {busy ? '发送中…' : '获取验证码'}
                        </button>
                    ) : (
                        <>
                            <button className="btn btn-primary" onClick={login} disabled={busy}>
                                {busy ? '登录中…' : '登录'}
                            </button>
                            <button className="btn" onClick={sendCode} disabled={busy || countdown > 0}>
                                {countdown > 0 ? `重新发送（${countdown}s）` : '重新发送验证码'}
                            </button>
                        </>
                    )}
                </div>
                <p className="login-foot">北域工作室 · Northland Studio</p>
            </div>
        </div>
    );
}
