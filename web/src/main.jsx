import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles/app.css';
import './styles/brand.css';

createRoot(document.getElementById('root')).render(<App />);

// PWA：注册 Service Worker（仅生产构建）
if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {
            /* 注册失败不影响主功能 */
        });
    });
}
