#!/bin/bash
# 部署第三批：日志查看 / fail2ban 操作 / 定时日报 / PWA + Agent 升级
set -euo pipefail
APP=/var/www/monitor-v2
SRC=/root/northland-stage3

echo "=== 0. 清理错误的 legacy 子域配置（域名未解析，仅保留 /legacy/ 路径）==="
rm -f /etc/nginx/sites-enabled/monitor-legacy
nginx -t 2>/dev/null | tail -1
systemctl reload nginx

rm -rf "$SRC" && mkdir -p "$SRC"
tar -xzf /root/northland-build3.tar.gz -C "$SRC"

echo "=== 1. 前端（含 PWA）==="
rsync -a --delete "$SRC/web/dist/" "$APP/web/dist/"
echo "  文件数: $(find "$APP/web/dist" -type f | wc -l)"
ls "$APP/web/dist" | head -8

echo "=== 2. 服务端 ==="
rsync -a "$SRC/server/src/" "$APP/server/src/"
node --check "$APP/server/src/index.js"
node --check "$APP/server/src/services/reporter.js"
node --check "$APP/server/src/routes/api.js"
echo "  语法 OK"

echo "=== 3. Agent 升级（日志列表 + fail2ban 操作）==="
cp "$SRC/server/install/agent.js" "$APP/server/install/agent.js"
cp "$APP/server/install/agent.js" /opt/xuanjian-agent/agent.js
systemctl restart xuanjian-agent
scp -q "$APP/server/install/agent.js" root@115.190.153.44:/opt/xuanjian-agent/agent.js && \
  ssh -o ConnectTimeout=8 root@115.190.153.44 'systemctl restart xuanjian-agent' && echo "  115 已升级"
echo "  HK 已升级"

echo "=== 4. 重启主控 ==="
pm2 restart monitor-v2 --update-env >/dev/null
sleep 6
curl -s --max-time 8 https://monitor.xuanjian.top/api/health
echo

echo "=== 5. 验证 PWA 资源 ==="
for p in /manifest.webmanifest /sw.js /logo.png; do
  echo -n "  $p -> "; curl -s -o /dev/null -w '%{http_code} %{content_type}\n' --max-time 8 "https://monitor.xuanjian.top$p"
done

echo
echo "=== 6. 验证日报接口（登录会话由脚本注入）==="
cd "$APP/server"
SID=$(node -e "
const crypto=require('crypto');
const Database=require('better-sqlite3');
const db=new Database('$APP/server/data/monitor.db');
const sid=crypto.randomBytes(24).toString('hex');
db.prepare('INSERT INTO sessions (id,email,level,ip,ua,created_at,expires_at) VALUES (?,?,?,?,?,?,?)').run(sid,'northland@xuanjian.top',2,'127.0.0.1','deploy-verify',Date.now(),Date.now()+3600000);
console.log(sid); process.exit(0);
")
echo -n "  /api/report/preview -> "
curl -s -o /tmp/rep.json -w '%{http_code}' --max-time 15 -H "Cookie: xj_monitor_sid=$SID" https://monitor.xuanjian.top/api/report/preview
echo
node -e "
const j=require('/tmp/rep.json');
console.log('  节点数 '+j.servers.length+'，未处理告警 '+j.alerts.length+'，24h 恢复 '+j.resolved24h);
process.exit(0);
" 2>/dev/null || echo "  （预览解析失败）"

echo -n "  发送测试日报: "
curl -s --max-time 30 -X POST -H "Cookie: xj_monitor_sid=$SID" -H 'Content-Type: application/json' \
  --data-binary '{}' https://monitor.xuanjian.top/api/report/send | head -c 200
echo
node -e "
const Database=require('better-sqlite3');
const db=new Database('$APP/server/data/monitor.db');
db.prepare(\"DELETE FROM sessions WHERE ua='deploy-verify'\").run();
process.exit(0);
"
