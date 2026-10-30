#!/bin/bash
# 部署 monitor-v2 到 HK：/var/www/monitor-v2，端口 3004（先并行运行，验证后再切 nginx）
set -euo pipefail

APP=/var/www/monitor-v2
SRC=/root/monitor-v2-stage

echo "=== 1. 目录准备 ==="
mkdir -p "$APP"
rsync -a --delete "$SRC/server/" "$APP/server/"
mkdir -p "$APP/web"
rsync -a --delete "$SRC/web/dist/" "$APP/web/dist/"
cp "$SRC/server/install/agent.js" "$APP/server/install/agent.js" 2>/dev/null || true
chmod +x "$APP/server/install/agent.sh" 2>/dev/null || true
echo "  已同步代码"

echo "=== 2. 服务端依赖 ==="
cd "$APP/server"
if [ ! -d node_modules ]; then
  npm install --omit=dev --silent 2>&1 | tail -3
fi
node --check src/index.js
echo "  语法 OK"

echo "=== 3. 复用旧 monitor 的邮件配置 ==="
OLD_ENV=/var/www/monitor/.env
SMTP_HOST=""; SMTP_PORT="465"; SMTP_USER=""; SMTP_PASS=""
if [ -f "$OLD_ENV" ]; then
  SMTP_HOST=$(grep -E '^SMTP_HOST=' "$OLD_ENV" | cut -d= -f2- | tr -d '"' || true)
  SMTP_PORT=$(grep -E '^SMTP_PORT=' "$OLD_ENV" | cut -d= -f2- | tr -d '"' || true)
  SMTP_USER=$(grep -E '^SMTP_USER=' "$OLD_ENV" | cut -d= -f2- | tr -d '"' || true)
  SMTP_PASS=$(grep -E '^SMTP_PASS=' "$OLD_ENV" | cut -d= -f2- | tr -d '"' || true)
fi
grep -E '^(SMTP|MAIL|NOTIFY)' /var/www/beiyu-website/.env 2>/dev/null | head -5 || true

cat > "$APP/server/.env" <<EOF
PORT=3004
HOST=127.0.0.1
DB_FILE=$APP/server/data/monitor.db
SEED_OPERATORS=northland@xuanjian.top
SEED_ADMIN_EMAIL=northland@xuanjian.top
SMTP_HOST=${SMTP_HOST:-smtp.exmail.qq.com}
SMTP_PORT=${SMTP_PORT:-465}
SMTP_USER=${SMTP_USER:-northland@xuanjian.top}
SMTP_PASS=${SMTP_PASS}
NOTIFY_EMAILS=${SMTP_USER:-northland@xuanjian.top}
EOF
chmod 600 "$APP/server/.env"
echo "  .env 已写入（密码脱敏显示）"
grep -E '^SMTP_(HOST|PORT|USER)=' "$APP/server/.env" | sed 's/^/    /'
grep -c '^SMTP_PASS=.\+' "$APP/server/.env" | sed 's/^/    密码是否非空: /'

echo "=== 4. 启动（pm2，端口 3004）==="
cd "$APP/server"
pm2 delete monitor-v2 >/dev/null 2>&1 || true
pm2 start src/index.js --name monitor-v2 --update-env >/dev/null
sleep 5
pm2 list | grep -E 'monitor-v2|name' | head -3

echo "=== 5. 健康检查 ==="
curl -s --max-time 8 http://127.0.0.1:3004/api/health | head -c 400
echo
echo -n "  首页 HTTP: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 8 http://127.0.0.1:3004/

echo "=== 6. 预置管理员检查 ==="
node -e "
const Database=require('better-sqlite3');
const db=new Database('$APP/server/data/monitor.db');
const rows=db.prepare('SELECT email,level,active FROM operators').all();
console.log('  运维账号: ' + JSON.stringify(rows));
const s=db.prepare(\"SELECT key,value FROM settings WHERE key LIKE 'smtp.%'\").all();
console.log('  SMTP 配置项数: ' + s.length);
process.exit(0);
"
