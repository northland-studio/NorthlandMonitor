#!/bin/bash
# 检查 115 / 机器人服务器上的 pm2 与 Agent 运行环境
set -u
echo "=== 115 ==="
ssh -o ConnectTimeout=8 -o StrictHostKeyChecking=no root@115.190.153.44 'bash -s' <<'EOF'
echo "  pm2: $(command -v pm2 || echo 未找到)"
echo "  pm2 版本: $(pm2 -v 2>/dev/null || echo 无)"
echo "  进程数: $(pm2 jlist 2>/dev/null | head -c 60)"
echo "  systemd PATH: $(systemctl show xuanjian-agent -p Environment 2>/dev/null)"
echo "  Agent 里试 pm2: $(su -l root -c 'pm2 jlist >/dev/null 2>&1 && echo ok || echo fail')"
EOF

echo
echo "=== 机器人服务器（经 HK 不可达，跳过）==="
