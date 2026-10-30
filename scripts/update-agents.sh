#!/bin/bash
# 更新三台机器的 Agent 到最新版本并重启
set -u
cd /root
rm -rf /root/agent-update && mkdir -p /root/agent-update
tar -xzf /root/agent-update.tar.gz -C /root/agent-update
NEW=/root/agent-update/agent.js
cp "$NEW" /var/www/monitor-v2/server/install/agent.js
node --check "$NEW"

echo "=== HK 本机 ==="
cp "$NEW" /opt/xuanjian-agent/agent.js
systemctl restart xuanjian-agent
sleep 2
systemctl is-active xuanjian-agent

echo "=== 115 ==="
scp -q "$NEW" root@115.190.153.44:/opt/xuanjian-agent/agent.js && \
  ssh -o ConnectTimeout=8 root@115.190.153.44 'systemctl restart xuanjian-agent && sleep 2 && systemctl is-active xuanjian-agent'

echo "=== 机器人服务器 ==="
scp -q -P 20043 "$NEW" root@43.248.3.161:/opt/xuanjian-agent/agent.js 2>/dev/null && \
  ssh -p 20043 -o ConnectTimeout=8 root@43.248.3.161 'systemctl restart xuanjian-agent && sleep 2 && systemctl is-active xuanjian-agent' || \
  echo "  跳过（需在机器人服务器手动更新）"

echo
echo "=== 等待一轮上报（15 秒）==="
sleep 15
node /root/check-nodes.cjs 2>&1
