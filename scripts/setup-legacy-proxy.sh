#!/bin/bash
# 为旧版 monitor 增加 legacy 入口：legacy.monitor.xuanjian.top（反代 3002）
set -u

echo "=== 1. 证书覆盖情况 ==="
ls /etc/letsencrypt/live/ 2>/dev/null | head -10
CERT_DIR=$(ls -d /etc/letsencrypt/live/*xuanjian.top 2>/dev/null | head -1)
echo "  使用证书目录: ${CERT_DIR:-无}"

if [ -z "$CERT_DIR" ]; then
  echo "  未找到证书，改用 monitor.xuanjian.top/legacy/ 路径方案"
else
  cat > /etc/nginx/sites-enabled/monitor-legacy <<EOF
server {
    listen 443 ssl http2;
    server_name legacy.monitor.xuanjian.top;

    ssl_certificate     $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
server {
    listen 80;
    server_name legacy.monitor.xuanjian.top;
    return 301 https://\$host\$request_uri;
}
EOF
fi

echo
echo "=== 2. 给新版面板加 /legacy/ 路径反代（无子域也能用）==="
if ! grep -q 'location /legacy/' /etc/nginx/sites-enabled/monitor; then
  python3 - <<'PY'
import re
p = '/etc/nginx/sites-enabled/monitor'
s = open(p, encoding='utf-8').read()
block = '''
    # 旧版面板入口（保留 PostgreSQL / AI 分析 / 文件管理 / Superskin 等功能）
    location /legacy/ {
        proxy_pass http://127.0.0.1:3002/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
'''
# 插到第一个 location / 之前
idx = s.find('    location / {')
if idx == -1:
    idx = s.find('location / {')
s = s[:idx] + block.lstrip('\n') + s[idx:]
open(p, 'w', encoding='utf-8').write(s)
print('  已插入 /legacy/ 反代')
PY
else
  echo "  已存在 /legacy/ 配置"
fi

echo
echo "=== 3. 语法检查并重载 ==="
nginx -t 2>&1 | tail -2
systemctl reload nginx

echo
echo "=== 4. 验证 ==="
echo -n "  新版首页: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 https://monitor.xuanjian.top/
echo -n "  旧版 /legacy/: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 https://monitor.xuanjian.top/legacy/
echo -n "  旧版 API: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 https://monitor.xuanjian.top/legacy/api/system
echo -n "  legacy 子域: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 https://legacy.monitor.xuanjian.top/ 2>/dev/null || echo '（域名未解析，正常）'
