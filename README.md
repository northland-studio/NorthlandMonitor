# 北域工作室 · 服务器统一监控面板

Northland Studio 的多服务器监控与运维面板。采用「主控 + Agent」架构，Agent 只主动出站上报，主控统一聚合指标、告警、日志与远程操作，支持 PWA 安装到桌面与手机。

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)
[![PWA](https://img.shields.io/badge/PWA-Service%20Worker-5A0FC8?logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)
[![Platform](https://img.shields.io/badge/Platform-Linux-FCC624?logo=linux&logoColor=black)](https://www.linux.org/)
[![License](https://img.shields.io/badge/License-MIT-2F7CE0)](LICENSE)

- 线上入口：<https://monitor.xuanjian.top>
- 主控部署：Linux 服务器，Node.js + Express + SQLite，nginx 反向代理
- 接入节点：HK 主控机、115 Web 服务器、群机器人服务器

## 功能

| 模块 | 说明 |
| --- | --- |
| 节点总览 | CPU / 内存 / 磁盘 / 网络 / 负载 / PM2 / systemd 实时状态，10 秒刷新 |
| 单机详情 | 1 小时至 30 天趋势曲线、进程 Top、systemd 服务列表、fail2ban 状态 |
| 日志查看 | 自动枚举各节点系统日志、PM2 日志、站点日志，支持查看末尾 100 / 200 / 500 行 |
| 文件管理 | 只读浏览白名单目录，查看文本与下载不超过 1 MB 的文件，带路径面包屑 |
| Fail2ban | 封禁统计与封禁 IP 列表，点击 IP 发起解封；手动封禁 / 解封需审批 |
| 远程操作 | 重启 systemd 服务、重启 PM2 进程、清理旧文件、查看系统概览 |
| 告警 | CPU / 内存 / 磁盘 / 负载 / 服务失败 / 节点离线阈值，邮件通知与冷却去重 |
| 定时报告 | 每日或每周发送品牌化 HTML 报告，收件人可按运维名单勾选，支持立即发送与预览 |
| 审计 | 登录、配置变更、动作申请 / 审批 / 执行、Agent 注册全部留痕 |
| PWA | 支持添加到主屏幕，作为独立应用运行 |

## 架构

```
                    ┌──────────── 主控（monitor-v2）────────────┐
                    │  Web 面板（React + Vite，PWA）            │
                    │  主控服务（Express，监听 127.0.0.1:3004） │
                    │  SQLite 存储（WAL 模式）                  │
                    │  SMTP 邮件（告警 + 定时报告）             │
                    └───┬──────────────┬──────────────┬───────┘
                        │ Agent 主动上报（HTTPS + 独立 Token）
          ┌─────────────┴──┐   ┌───────┴────────┐   ┌─┴──────────────┐
          │ 节点 A（Agent）│   │ 节点 B（Agent）│   │ 节点 C（Agent）│
          └────────────────┘   └────────────────┘   └────────────────┘
```

设计要点：

- Agent 不监听任何端口，只主动出站上报，主控不需要保存任何服务器的密码或私钥
- 注册使用一次性 Token（默认 10 分钟有效，用过即失效），每台节点持有独立 Token（哈希存储）
- 远程操作需主控审批，Agent 侧再次校验动作白名单、参数格式与时效（防重放）
- 只读动作（日志、文件、系统概览）免审批直接执行，但同样写入审计

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9
- Linux（Agent 依赖 systemd；主控在 macOS / Windows 也可运行，但远程操作需目标机为 systemd）

### 启动主控

```bash
git clone https://github.com/northland-studio/NorthlandMonitor.git
cd NorthlandMonitor

# 1. 构建前端
cd web
npm install
npm run build

# 2. 安装主控依赖
cd ../server
npm install --omit=dev

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env：PORT / DB_FILE / SEED_OPERATORS / SEED_ADMIN_EMAIL / SMTP_*

# 4. 启动
npm start
# 或使用 pm2
pm2 start src/index.js --name monitor-v2
```

首次启动会按 `SEED_OPERATORS` 初始化运维账号，`SEED_ADMIN_EMAIL` 指定管理员邮箱。

### 接入新节点

1. 登录面板，进入「添加节点」，点击「生成安装命令」
2. 在目标服务器以 root 执行面板给出的命令：

```bash
curl -fsSL https://<主控域名>/install/agent.sh | sudo bash -s -- \
  --master https://<主控域名> --token <一次性Token>
```

3. 约 10 秒后面板自动出现该节点，可重命名、查看趋势、配置告警

Agent 安装位置与运行信息：

| 项目 | 路径 |
| --- | --- |
| 程序 | `/opt/xuanjian-agent/agent.js` |
| 配置 | `/etc/xuanjian-agent/config.json` |
| 状态 | `/etc/xuanjian-agent/state.json` |
| 日志 | `/var/log/xuanjian-agent.log` |
| 服务 | `systemctl status xuanjian-agent` |

## 配置项

主控所有可调参数存于 `settings` 表，可在面板「设置」页修改。

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `alert.cpuPct` | 85 | CPU 使用率告警阈值（百分比） |
| `alert.memPct` | 90 | 内存使用率告警阈值 |
| `alert.diskPct` | 85 | 磁盘使用率告警阈值 |
| `alert.loadPerCore` | 2.5 | 每核负载告警阈值 |
| `alert.offlineSeconds` | 90 | 无心跳判定离线的秒数 |
| `alert.cooldownSeconds` | 600 | 同类告警冷却时间 |
| `metric.reportIntervalMs` | 10000 | Agent 采集与上报间隔 |
| `metric.retentionDays` | 30 | 指标保留天数 |
| `smtp.host` / `smtp.port` | - | SMTP 服务器与端口 |
| `smtp.user` / `smtp.pass` | - | SMTP 账号与授权码 |
| `notify.emails` | - | 告警收件人（逗号分隔） |
| `report.enabled` | 1 | 是否启用定时报告 |
| `report.frequency` | daily | `daily` 日报 / `weekly` 周报 |
| `report.weekday` | 1 | 周报发送日，1 为周一 |
| `report.hour` | 9 | 发送时间（0-23 点） |
| `report.recipients` | 空 | 报告收件人，留空回退 `notify.emails` |

环境变量（`server/.env`）：

| 变量 | 说明 |
| --- | --- |
| `PORT` / `HOST` | 监听端口与地址，默认 `3004` / `127.0.0.1` |
| `DB_FILE` | SQLite 文件路径 |
| `SEED_OPERATORS` | 首次启动初始化的运维邮箱，逗号分隔 |
| `SEED_ADMIN_EMAIL` | 管理员邮箱（level 2） |
| `SMTP_*` / `NOTIFY_EMAILS` | 邮件通道默认值 |
| `COOKIE_SECURE` | 生产为 1；本地 http 调试可设为 0 |

## 目录结构

```
NorthlandMonitor/
├── agent/
│   └── agent.js                # 单文件 Agent（零第三方依赖）
├── server/
│   ├── src/
│   │   ├── index.js            # Express 主控入口、静态资源与定时任务
│   │   ├── db.js               # 表结构、默认配置
│   │   ├── auth.js             # 邮箱验证码登录、会话、权限实时校验
│   │   ├── routes/agent.js     # Agent 注册 / 上报 / 动作结果
│   │   ├── routes/api.js       # 面板 API
│   │   └── services/
│   │       ├── alerter.js      # 阈值告警与邮件通知
│   │       └── reporter.js     # 定时报告（日报 / 周报）
│   ├── install/agent.sh        # 一键安装脚本
│   └── install/agent.js        # 下发的 Agent 副本
├── web/
│   ├── src/
│   │   ├── App.jsx             # 路由与布局
│   │   ├── pages/              # 总览、详情、告警、添加节点、设置
│   │   ├── components/         # 图表、图标、Toast
│   │   ├── lib/api.js          # 请求封装与格式化
│   │   └── styles/             # 基础、品牌、精修、侧栏、文件页样式
│   └── public/                 # manifest、Service Worker、品牌图片
├── scripts/                    # 部署、验证、运维脚本
├── docs/DEPLOY.md              # 部署与回滚说明
└── README.md
```

## API 概览

### Agent 接入

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/agent/register` | 注册节点（一次性 Token） |
| POST | `/api/agent/report` | 上报指标，返回待执行动作 |
| POST | `/api/agent/action-result` | 回传动作执行结果 |

### 面板

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/send-code` | 发送登录验证码（邮件带姓名） |
| POST | `/api/auth/login` | 验证码登录 |
| GET | `/api/auth/me` | 当前登录信息（姓名、邮箱、权限） |
| GET | `/api/servers` | 节点列表与最新指标 |
| GET | `/api/servers/:id/metrics` | 指标趋势（按小时区间） |
| GET | `/api/servers/:id/detail` | 节点详情（含进程、服务、fail2ban） |
| PATCH | `/api/servers/:id` | 重命名节点 / 备注 |
| POST | `/api/install-tokens` | 生成一次性安装命令 |
| GET / POST | `/api/actions` | 动作列表 / 提交动作 |
| POST | `/api/actions/:id/approve` / `reject` | 审批动作 |
| GET | `/api/alerts` | 告警列表 |
| GET | `/api/report/preview-html` | 预览报告邮件 HTML |
| POST | `/api/report/send` | 立即发送报告 |
| GET / PUT | `/api/settings` | 读取 / 修改配置 |
| GET | `/api/audit` | 审计日志 |
| GET | `/api/health` | 健康检查 |

## 远程操作白名单

| 动作 | 允许对象 |
| --- | --- |
| `service.restart` / `start` / `stop` | `xuanjian-group-bot`、`napcat`、`nginx`、`mysql`、`redis`、`docker`、`fail2ban`、`xuanjian-*` |
| `pm2.restart` | `xuanjian-guild`、`monitor`、`zhuopu`、`beiyu`、`nork`、`northbooker`、`xuanjian-notice`、`napcat` |
| `fail2ban.ban` / `unban` | jail 名与 IP 需通过正则校验 |
| `log.list` / `log.tail` | `/var/log/`、`/var/www/`、`/opt/`、`/root/.pm2/logs/` |
| `file.list` / `file.read` / `file.download` | `/var/www/`、`/var/log/`、`/opt/`、`/root/`、`/etc/nginx/`、`/srv/`、`/home/`、`/tmp/`，下载不超过 1 MB |
| `disk.cleanup` | `/var/beifen/`、`/opt/minecraft-backups/`、`/tmp/` |
| `system.info` | 任意节点 |

审批规则：只读动作免审批；破坏性动作需审批，且运维人数大于 1 时申请人不能审批自己提交的动作。

## 安全设计

- Agent 不开放入站端口，仅主动出站 HTTPS
- 注册 Token 一次性、限时、用过即废；每节点独立 Token，主控只存哈希
- Agent 侧对动作做三重校验：类型白名单、参数白名单、时间戳新鲜度（2 分钟内）
- 文件与日志访问使用 `realpath` 解析后校验前缀，拒绝 `..` 与空字节
- 登录仅限运维名单内邮箱，验证码 10 分钟有效、最多 5 次尝试，会话 24 小时 HttpOnly Cookie
- 权限与姓名实时读取数据库，名单调整后无需重新登录即生效
- 主控仅监听 `127.0.0.1`，对外由 nginx 提供 HTTPS

## 运维命令

```bash
# 主控
pm2 status monitor-v2
pm2 logs monitor-v2 --lines 100
curl -s https://<主控域名>/api/health

# 任一节点
systemctl status xuanjian-agent
tail -f /var/log/xuanjian-agent.log

# 数据库备份（WAL 模式需连 -wal / -shm 一起备份）
sqlite3 server/data/monitor.db ".backup '/backup/monitor-$(date +%F).db'"
```

数据保留策略：指标 30 天、已处理告警 30 天、审计 90 天、会话 24 小时、安装令牌一次性加 10 分钟过期。

## 开发

```bash
# 前端开发模式（Vite，代理到本地主控）
cd web
npm run dev

# 主控开发模式
cd server
npm run dev
```

代码风格：服务端使用 CommonJS，前端使用 ES Module，两空格缩进，中文注释，提交信息使用中文 Conventional Commits。

## 变更记录

### 2026-10-30

- 首个版本：主控 + Agent 架构、节点总览与详情、告警邮件、审计
- 补齐日志查看、Fail2ban 管理、定时报告、PWA、文件管理
- 定时报告支持每日 / 每周频率、收件人勾选与品牌化 HTML 模板
- 修复缓存策略导致发版后浏览器读到旧前端的问题（HTML 不缓存、Service Worker 带版本号）
- 权限改为实时校验，运维名单调整即时生效

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
