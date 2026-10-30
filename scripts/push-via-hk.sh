#!/bin/bash
# 在 HK 上从 bundle 推送仓库到 GitHub（临时使用 token，完成后清理）
set -euo pipefail

REPO=/root/northland-monitor-push
TOKEN=$(cat /root/nm.token)

rm -rf "$REPO"
mkdir -p "$REPO"

echo "=== 1. 从 bundle 克隆 ==="
cd "$REPO"
git clone /root/northland-monitor.bundle repo --quiet
cd repo
git log --oneline -3
echo "  提交数: $(git rev-list --count HEAD)"

echo
echo "=== 2. 设置远端并推送 ==="
git remote remove origin 2>/dev/null || true
git remote add origin "https://x-access-token:${TOKEN}@github.com/northland-studio/NorthlandMonitor.git"
git push -u origin master 2>&1 | tail -6

echo
echo "=== 3. 远端核对 ==="
git ls-remote --heads origin 2>/dev/null | head -3

echo
echo "=== 4. 清理 token 与 bundle ==="
git remote set-url origin https://github.com/northland-studio/NorthlandMonitor.git
rm -f /root/nm.token /root/northland-monitor.bundle
echo "  已清理"
