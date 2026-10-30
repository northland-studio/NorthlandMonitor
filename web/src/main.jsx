import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles/app.css';
import './styles/brand.css';
import './styles/polish.css';
import './styles/sidebar.css';
import './styles/files.css';

createRoot(document.getElementById('root')).render(<App />);

/* PWA：注册 Service Worker（带版本查询串，绕过 CDN 边缘缓存） */
const SW_VERSION = 'v4';
const SW_URL = `/sw.js?v=${SW_VERSION}`;
const RELOAD_FLAG = 'nl_monitor_sw_controller_reload';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register(SW_URL)
            .then((reg) => {
                if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
                reg.addEventListener('updatefound', () => {
                    const sw = reg.installing;
                    if (!sw) return;
                    sw.addEventListener('statechange', () => {
                        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
                            sw.postMessage({ type: 'SKIP_WAITING' });
                        }
                    });
                });
            })
            .catch(() => {
                /* 注册失败不影响主功能 */
            });

        // 新 SW 接管后自动刷新一次，确保加载最新前端
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (sessionStorage.getItem(RELOAD_FLAG)) return;
            sessionStorage.setItem(RELOAD_FLAG, '1');
            window.location.reload();
        });
    });
}
