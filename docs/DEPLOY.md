# 部署与迁移说明（Northland Monitor v2）

## 1. 环境事实

| 角色 | 主机 | 路径 / 服务 |
| --- | --- | --- |
| 主控（面板 + API） | HK `64.90.13.2`（Ubuntu 24.04，2C/2G） | `/var/www/monitor-v2`，pm2 `monitor-v2`，监听 `127.0.0.1:3004`，nginx `monitor.xuanjian.top` |
| 节点 | HK 本机 | systemd `xuanjian-agent` |
| 节点 | 115 `115.190.153.44`（Ubuntu 24.04.4） | systemd `xuanjian-agent` |
| 节点 | 群机器人 `43.248.3.161:20043`（Ubuntu 22.04） | systemd `xuanjian-agent` |
| 旧面板（保留回滚） | HK | `/var/www/monitor`，pm2 `monitor`，`:3002` |

## 2. 发布流程

```powershell
# 本地：构建前端
cd H:\chengxuyuanma\monitor-v2\web
npm install
npm run build

# 打包 server + web/dist 上传（示例）
# 然后到 HK 解包、rsync 到 /var/www/monitor-v2、重启 pm2
```

HK 上关键步骤：

```bash
rsync -a --delete /root/stage/web/dist/ /var/www/monitor-v2/web/dist/
rsync -a /root/stage/server/src/ /var/www/monitor-v2/server/src/
cp /root/stage/server/install/agent.js /var/www/monitor-v2/server/install/agent.js
cd /var/www/monitor-v2/server && node --check src/index.js
pm2 restart monitor-v2 --update-env
curl -s https://monitor.xuanjian.top/api/health
```

## 3. Agent 升级

```bash
# 单台
scp agent.js root@<host>:/opt/xuanjian-agent/agent.js
ssh root@<host> 'node --check /opt/xuanjian-agent/agent.js && systemctl restart xuanjian-agent'

# 群机器人服务器（HK 无密钥，需从本机用密码 SSH，或手动执行）
```

## 4. 新增节点

1. 面板「添加节点」→ 生成命令
2. 目标机执行 `curl -fsSL https://monitor.xuanjian.top/install/agent.sh | sudo bash -s -- --master ... --token ...`
3. 面板重命名节点，按需在「设置」调整告警阈值

## 5. 回滚

```bash
# 面板回滚到旧版（3002）
sed -i 's|proxy_pass http://127.0.0.1:3004|proxy_pass http://127.0.0.1:3002|' /etc/nginx/sites-enabled/monitor
nginx -t && systemctl reload nginx

# 停用新面板
pm2 stop monitor-v2

# 停用某节点 Agent
systemctl disable --now xuanjian-agent
```

## 6. 备份

需要备份的文件：

- `/var/www/monitor-v2/server/data/monitor.db`（SQLite，WAL 模式，需连同 `-wal`/`-shm`）
- `/var/www/monitor-v2/server/.env`

建议加入官网每日备份脚本（`/var/www/xuanjian-guild/scripts/backup-to-qiniu.js` 同类逻辑）。

## 7. 旧版面板（legacy）

旧面板 `/var/www/monitor`（pm2 `monitor`，:3002）保留，用于 PostgreSQL 管理 / AI 日志分析 / 文件管理 / Superskin 等功能：

- 入口：`https://monitor.xuanjian.top/legacy/`（nginx 反代到 3002，包含 WebSocket 升级头，支持旧版实时日志流）
- 下线：删除 nginx `monitor` 站点里的 `location /legacy/` 段 → `nginx -t && systemctl reload nginx` → `pm2 delete monitor`

## 8. 安全边界

- Agent 不监听端口，只出站 HTTPS
- 注册使用一次性 Token（10 分钟，用过即废）
- 每台节点持有独立 Token，哈希存储于主控
- 远程操作：主控审批 + Agent 侧白名单/参数/时效三重校验，动作记录写入审计
- 面板登录：邮箱验证码（仅名单内运维），会话 24 小时 HttpOnly Cookie
- nginx 侧仅暴露 443，3004 只监听 127.0.0.1

## 9. 运维名单迁移

旧版名单在 `/var/www/monitor/operators.json`，已导入新版 `operators` 表：

```bash
# 重新导入（幂等，已存在的邮箱跳过）
bash scripts/import-operators.sh
```

导入后默认均为只读运维；管理员仅 `northland@xuanjian.top`。
