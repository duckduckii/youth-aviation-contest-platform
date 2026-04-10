# 全国青少年安全与应急科普创新大赛（航模方向）作品提交系统

基于 `Node.js + Express + EJS + MySQL + Redis` 的作品提交平台，覆盖报名登录、赛道选择、作品上传、最终提交和管理员统计看板。

## 当前部署模型

仓库现在默认面向 `ALB + ESS + RDS + Redis + OSS`：

- 普通业务流量：`ALB -> ECS(app 节点)`
- 管理导出下载：`包月 ECS(export 节点) -> 公网下载`
- 作品原始文件：浏览器直传 `OSS`
- 导出 ZIP / manifest：只落 `export` 节点本地磁盘

因此现在有两种节点角色：

- `export`：包月 ECS，负责管理导出下载
- `app`：ESS 扩容 ECS，只跑普通业务流量

当前建议的云上进程/连接池口径：

- `export`（包月 `8C16G`，同时接普通业务流量时）：`APP_WORKERS=6`，`DB_CONNECTION_LIMIT=8`
- `app`（ESS `4C8G`）：`APP_WORKERS=4`，`DB_CONNECTION_LIMIT=8`

以上两个值会由 `./deploy/release.sh` 按节点角色自动写入 `.env.instance`。

## 发布命令

默认云上发布，等价于“包月 ECS 导出节点”：

```bash
./deploy/release.sh
```

首次初始化数据库：

```bash
./deploy/release.sh --init-db
```

首次还要写入演示账号：

```bash
./deploy/release.sh --init-db --seed-demo
```

ESS 扩容节点或自定义镜像启动后，改成普通业务节点：

```bash
./deploy/release.sh --role app
```

在云上 `app` 角色下，这个命令会跳过 `docker compose build`，直接使用自定义镜像内已有的 `youth-aviation-contest:latest`。
这样 ESS 私网节点不需要出公网拉取 `node:20-alpine`。

本地调试模式：

```bash
./deploy/release.sh --local
```

## 关键约束

- 生产默认 `OSS`，不再建议使用 `local` 作为线上存储。
- 管理导出下载需要走包月 ECS 公网，因此下载入口应使用单独域名，例如 `download.example.com`。
- 如果主站和导出站是不同子域名，需要配置 `SESSION_COOKIE_DOMAIN=.example.com`。
- ESS 扩容节点不应执行 `db:init` / `db:seed`。

## 文档索引

- 权威部署文档：[deploy/README.md](./deploy/README.md)
- 根目录共享环境模板：[.env.example](./.env.example)
- 本地调试模板：[deploy/templates/env.docker.local.example](./deploy/templates/env.docker.local.example)
- 云上 OSS 模板：[deploy/templates/env.docker.oss.example](./deploy/templates/env.docker.oss.example)
