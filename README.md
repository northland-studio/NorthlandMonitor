# 北域工作室 · 服务器统一监控面板

Northland Studio 的多服务器监控与运维面板。替代原单体 `monitor` 项目，改为「主控 + Agent」架构，支持多机接入、历史趋势、告警邮件、白名单远程操作与审计。

- 线上地址：https://monitor.xuanjian.top
- 主控部署：HK `64.90.13.2` → `/var/www/monitor-v2`（pm2 `monitor-v2`，端口 3004）
- 已接入节点：HK 主控（官网）、115 Web 服务器、群机器人服务器

## 功能清单

| 模块 | 说明 |
| --- | --- |
| 节点总览 | CPU / 内存 / 磁盘 / 网络 / 负载 / PM2 / systemd 实时状态，10 秒刷新 |
| 单机详情 | 1h~30d 趋势曲线、进程 Top、systemd 服务列表、fail2ban、日志、远程操作 |
| 日志查看 | 自动列出各节点上 38+ 个日志文件（系统 / PM2 / 站点），支持 100/200/500 行查看（只读动作免审批） |
| Fail2ban | 实时封禁统计 + 封禁 IP 列表，点击 IP 即可发起解封；手动封禁/解封需审批 |
| 远程操作 | 重启 systemd/pm2、清理旧文件、系统概览；白名单 + 审批 + 审计 |
| 告警 | CPU/内存/磁盘/负载/服务失败/离线，邮件通知 + 冷却去重 |
| 定时日报 | 每天固定时间发送集群概览 + 24h 峰值 + 未处理告警，支持手动立即发送 |
| PWA | manifest + Service Worker，可「添加到主屏幕」当独立应用使用 |
| 旧版兼容 | 旧面板保留在 /legacy/（PostgreSQL 管理、AI 日志分析、文件管理、Superskin） |

## 旧版功能保留

旧版 monitor 仍以 pm2 `monitor` 运行在 3002，通过 nginx 的 `/legacy/` 路径反代暴露：

- 入口：https://monitor.xuanjian.top/legacy/
- 下线：删掉 nginx `monitor` 站点里的 `location /legacy/` 段 → `nginx -t && systemctl reload nginx` → `pm2 delete monitor`

## 架构

```
                    ┌────────────── HK 主控（monitor-v2）──────────────┐
                    │  Web 面板（React/Vite）                          │
                    │  主控服务（Express + better-sqlite3，:3004）      │
                    │  SQLite：nodes / metrics / actions / alerts /    │
                    │           tokens / operators / audit / settings  │
                    │  告警：SMTP 邮件（企业邮）                        │
                    └───────▲──────────────▲──────────────▲───────────┘
                            │ Agent 主动上报（HTTPS + 专属 Token）│
                ┌───────────┴──┐   ┌───────┴────────┐   ┌─┴──────────────┐
                │ HK 本机      │   │ 115 服务器      │   │ 群机器人服务器  │
                │ xuanjian-agent│  │ xuanjian-agent │   │ xuanjian-agent │
                └──────────────┘   └────────────────┘   └────────────────┘
```

- **Agent 只主动出站**，不监听端口，不需要主控保存任何服务器密码/私钥
- **采集**：CPU / 内存 / 负载 / 磁盘 / 网络速率 / 进程 Top / PM2 / systemd / fail2ban
- **远程操作**：白名单动作 + 申请人/审批人闭环 + 全量审计；Agent 侧再校验一次参数与时间戳（防重放）

## 目录结构

```
monitor-v2/
├── agent/agent.js              # 单文件 Agent（零依赖，systemd 托管）
├── server/
│   ├── src/
│   │   ├── index.js            # Express 主控入口
│   │   ├── db.js               # SQLite 表结构与默认配置
│   │   ├── auth.js             # 邮箱验证码登录 + 会话
│   │   ├── routes/agent.js     # Agent 注册 / 上报 / 动作结果
│   │   ├── routes/api.js       # 面板 API
│   │   └── services/alerter.js # 阈值告警 + 邮件通知
│   ├── install/agent.sh        # 一键安装脚本（curl | bash）
│   └── install/agent.js        # 安装脚本分发的 Agent 副本
├── web/                        # React + Vite 前端（品牌：北域工作室）
└── scripts/                    # 部署与运维脚本
```

## 快速接入一台新服务器

1. 登录面板 → 「添加节点」→ 生成安装命令（一次性 Token，默认 10 分钟有效）
2. 在目标服务器以 root 执行：

```bash
curl -fsSL https://monitor.xuanjian.top/install/agent.sh | sudo bash -s -- \
  --master https://monitor.xuanjian.top --token <一次性Token>
```

3. 约 10 秒后面板自动出现该节点，可重命名、看趋势、配告警

Agent 安装位置：`/opt/xuanjian-agent/agent.js`，配置 `/etc/xuanjian-agent/config.json`，服务 `xuanjian-agent.service`，日志 `/var/log/xuanjian-agent.log`。

## 常用运维命令

```bash
# 主控
pm2 status monitor-v2
pm2 logs monitor-v2 --lines 50
curl -s https://monitor.xuanjian.top/api/health

# Agent（任一节点）
systemctl status xuanjian-agent
journalctl -u xuanjian-agent -n 50
tail -f /var/log/xuanjian-agent.log
```

## 数据与保留策略

| 数据 | 保留 |
| --- | --- |
| 指标 `metrics` | 30 天（`metric.retentionDays` 可调） |
| 已处理告警 | 30 天 |
| 审计日志 | 90 天 |
| 会话 | 24 小时 |
| 安装令牌 | 一次性 + 10 分钟过期 |

采集间隔默认 10 秒（`metric.reportIntervalMs`）。

## 告警规则（可在「设置 → 告警与采集」调整）

| 规则 | 默认阈值 |
| --- | --- |
| CPU 使用率 | ≥ 85% |
| 内存使用率 | ≥ 90% |
| 磁盘使用率 | ≥ 85% |
| 每核负载 | ≥ 2.5 |
| 服务失败 | 任一 systemd 服务 failed |
| 节点离线 | 90 秒无心跳 |
| 同类冷却 | 600 秒 |

告警通过企业邮发送到 `notify.emails`。

## 远程操作白名单

| 动作 | 允许对象 |
| --- | --- |
| `service.restart/start/stop` | `xuanjian-group-bot`、`napcat`、`nginx`、`mysql`、`redis`、`docker`、`fail2ban`、`xuanjian-*` |
| `pm2.restart` | `xuanjian-guild`、`monitor`、`zhuopu`、`beiyu`、`nork`、`northbooker`、`xuanjian-notice`、`napcat` |
| `log.tail` | `/var/log/`、`/var/www/`、`/opt/`、`/root/.pm2/logs/` |
| `disk.cleanup` | `/var/beifen/`、`/opt/minecraft-backups/`、`/tmp/` |
| `system.info` | 任意节点 |

审批规则：申请人不能审批自己的动作（运维人数 > 1 时）。

## 部署（从零重建）

```bash
# 1. 构建前端
cd web && npm install && npm run build

# 2. 上传 server/ 与 web/dist 到 /var/www/monitor-v2
# 3. 安装依赖并启动
cd /var/www/monitor-v2/server
npm install --omit=dev
cp .env.example .env   # 按需填写 PORT/DB_FILE/SEED_OPERATORS/SMTP_*
pm2 start src/index.js --name monitor-v2

# 4. nginx 指向 3004
# proxy_pass http://127.0.0.1:3004;
```

首次启动会用 `SEED_OPERATORS` 建运维账号（`SEED_ADMIN_EMAIL` 为管理员）。

## 变更记录

### 2026-10-30
- 新项目 `monitor-v2` 上线，替换原单体 monitor（3002 端口保留可回滚）
- 三节点接入并验证：HK / 115 / 群机器人（PM2 13 / 8 / 1 个进程）
- 前端品牌化为「北域工作室 Northland Studio」，使用官方 logo 与 16:9 品牌图
- 修复：systemd 单元名解析、PM2 在 systemd 环境下的 PATH、进度条布局、指标计数显示
- 115 磁盘清理：MC 存档备份保留 3 天（并给备份脚本加自动清理）、删除 31 天官网整站备份，磁盘 89% → 59%
