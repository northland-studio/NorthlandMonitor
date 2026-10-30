#!/bin/bash
# 玄剑监控 Agent 一键安装脚本（由主控生成命令调用）
#   curl -fsSL https://monitor.xuanjian.top/install/agent.sh | sudo bash -s -- --master URL --token TOKEN
set -euo pipefail

MASTER=""
TOKEN=""
AGENT_SRC=""

while [ $# -gt 0 ]; do
  case "$1" in
    --master) MASTER="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --src) AGENT_SRC="$2"; shift 2 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

if [ -z "$MASTER" ] || [ -z "$TOKEN" ]; then
  echo "用法: bash agent.sh --master https://monitor.xuanjian.top --token <一次性Token>"
  exit 1
fi

if [ "$(id -u)" != "0" ]; then
  echo "请用 root 运行（sudo）"
  exit 1
fi

echo "==> 安装玄剑监控 Agent"
echo "    主控: $MASTER"

# 1. Node 检查
if ! command -v node >/dev/null 2>&1; then
  echo "==> 未检测到 Node.js，正在安装 Node 20…"
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
    apt-get install -y nodejs >/dev/null 2>&1
  else
    echo "无法自动安装 Node.js，请先安装 node >= 18"; exit 1
  fi
fi
echo "    Node: $(node -v)"

# 2. 目录与配置
install -d -m 700 /etc/xuanjian-agent
install -d -m 755 /opt/xuanjian-agent

# 3. 获取 agent.js（优先从主控下载，支持本地 --src 覆盖）
if [ -n "$AGENT_SRC" ] && [ -f "$AGENT_SRC" ]; then
  cp "$AGENT_SRC" /opt/xuanjian-agent/agent.js
else
  curl -fsSL "$MASTER/install/agent.js" -o /opt/xuanjian-agent/agent.js
fi
chmod 755 /opt/xuanjian-agent/agent.js
node --check /opt/xuanjian-agent/agent.js

# 4. 写配置
cat > /etc/xuanjian-agent/config.json <<EOF
{
  "master": "$MASTER",
  "token": "$TOKEN"
}
EOF
chmod 600 /etc/xuanjian-agent/config.json
rm -f /etc/xuanjian-agent/state.json

# 5. systemd 服务
cat > /etc/systemd/system/xuanjian-agent.service <<'EOF'
[Unit]
Description=Xuanjian Monitor Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/env node /opt/xuanjian-agent/agent.js
Restart=always
RestartSec=5
StandardOutput=null
StandardError=null
# 允许读取系统指标与日志，但不授予额外内核能力
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=/var/log /opt/xuanjian-agent /etc/xuanjian-agent

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable xuanjian-agent >/dev/null 2>&1
systemctl restart xuanjian-agent
sleep 4

echo "==> 服务状态"
systemctl is-active xuanjian-agent || true
echo "==> 最近日志"
tail -8 /var/log/xuanjian-agent.log 2>/dev/null || true

echo
echo "安装完成。回到面板刷新即可看到该节点。"
