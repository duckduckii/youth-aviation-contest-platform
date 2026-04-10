# 部署说明

当前仓库只保留这一份部署文档，默认面向 `ALB + ESS + RDS + Redis + OSS`。

## 架构

- 主站流量：`ALB -> ECS(app 节点)`
- 导出下载：`download.example.com -> 包月 ECS(export 节点)`
- 原始上传文件：浏览器直传 `OSS`
- 导出 ZIP / manifest：只保存在 `export` 节点本地

不要让导出下载走 OSS 直链，也不要让它落到普通 ESS 节点。

## 两类配置文件

- `.env`
  共享业务配置，所有节点基本一致，包含 `RDS / Redis / OSS / 域名 / Cookie` 等参数。
- `.env.instance`
  机器本地覆盖文件，由 `./deploy/release.sh` 自动生成，用来区分节点角色和本机规格。

当前默认会写入：

- 包月 `export` 节点（`8C16G`，同时接普通业务流量）：
  - `APP_WORKERS=6`
  - `DB_CONNECTION_LIMIT=8`
- ESS `app` 节点（`4C8G`）：
  - `APP_WORKERS=4`
  - `DB_CONNECTION_LIMIT=8`

自定义镜像可以包含代码和 `.env`，但不要依赖镜像里已有的 `.env.instance`。

## 包月 ECS

先编辑根目录 `.env`，至少确认：

- `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD`
- `REDIS_HOST` 或 `REDIS_URL`
- `STORAGE_DRIVER=oss`
- `OSS_*`
- `EXPORT_PUBLIC_BASE_URL=https://download.example.com`
- `SESSION_COOKIE_SECURE=true`
- `SESSION_COOKIE_DOMAIN=.example.com`

如果你现在只是想先把服务跑起来，不想一上来就看完整个 `.env`，就只改下面这些行。别的先不要动：

```env
SESSION_SECRET=自己生成一串很长的随机字符串

DB_HOST=RDS内网地址
DB_PORT=3306
DB_USER=MySQL用户名
DB_PASSWORD=MySQL密码
DB_NAME=数据库名

REDIS_URL=redis://<Redis实例ID>:<Redis密码>@<Redis内网地址>:6379/0

STORAGE_DRIVER=oss
OSS_REGION=oss-cn-hangzhou
OSS_BUCKET=Bucket名
OSS_ACCESS_KEY_ID=RAM AccessKey ID
OSS_ACCESS_KEY_SECRET=RAM AccessKey Secret
OSS_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
OSS_INTERNAL_ENDPOINT=https://oss-cn-hangzhou-internal.aliyuncs.com
```

说明：

- Redis 信息优先填写在 `REDIS_URL` 这一行。
- 阿里云 Redis / Tair 若要求账号密码认证，推荐直接使用 `REDIS_URL`，其中“账号”通常就是实例 ID。
- `REDIS_URL` 里 3 个东西不要填错：
  - `<Redis实例ID>`：例如 `r-bpxxxx`
  - `<Redis密码>`：Redis 控制台里的密码
  - `<Redis内网地址>`：Redis 控制台里的内网连接地址
- 如果当前只是“公网 IP + HTTP”联调，不是正式域名 HTTPS，可临时改成：
  - `SESSION_COOKIE_SECURE=false`
  - `SESSION_COOKIE_DOMAIN=`
  - `EXPORT_PUBLIC_BASE_URL=`

然后执行：

```bash
./deploy/release.sh
```

首次初始化数据库：

```bash
./deploy/release.sh --init-db
```

如果还要写入演示账号：

```bash
./deploy/release.sh --init-db --seed-demo
```

## ESS 扩容节点

ESS 节点一般没有公网，只走内网和 ALB。

建议在自定义镜像启动后的用户数据、启动脚本或首次启动命令里执行：

```bash
cd /root/youth-aviation-contest-platform
./deploy/release.sh --role app
```

这样会重写本机 `.env.instance`，把节点切成普通业务节点。
在云上 `app` 角色下，发布脚本会跳过 `docker compose build`，直接使用自定义镜像内已有的 `youth-aviation-contest:latest`。
这样 ESS 私网节点不需要再出公网拉取 `node:20-alpine`。

如果你是“先做自定义镜像，再让 ESS 基于该镜像创建新实例”，建议不要把会变化的配置直接写死在镜像里的 `.env`。
阿里云 ESS 的伸缩配置支持 `UserData`，Linux 实例可在首次启动时执行实例自定义脚本；当前仓库同时保留镜像内的 `systemd` oneshot 首启服务，作为应用发布和健康检查的兜底入口。

当前仓库的 `./deploy/release.sh --role app` 在云上 `app` 角色成功发布后，会自动安装并启用：

- `youth-contest-ess-firstboot.service`

该服务会在每次开机时读取当前 ECS 实例 ID；只有当实例 ID 发生变化时，才会自动补跑一次：

```bash
cd /root/youth-aviation-contest-platform
./deploy/release.sh --role app
```

这样镜像源机和后续 ESS 新实例都能共用同一套自愈逻辑，不依赖控制台额外再写一份 UserData。

如果你希望 ESS 在扩容时动态覆盖会变更的基础设施地址，例如新建后的 `DB_HOST`，当前仓库也支持额外的外部覆盖文件：

- 路径：`/etc/youth-contest/bootstrap.env`
- 生效时机：`./deploy/release.sh` 执行时自动加载
- 优先级：会写入 `.env.instance`，覆盖 `.env` 里的同名配置

推荐做法：

1. 自定义镜像里保留稳定不常变的基础配置。
2. 在 ESS 伸缩配置的 `UserData` 里写入当前环境的 `DB_HOST` 等参数到 `/etc/youth-contest/bootstrap.env`。
3. 由镜像内的 `youth-contest-ess-firstboot.service` 在新实例首启时执行 `./deploy/release.sh --role app`，自动把这些值落到 `.env.instance` 并启动服务。

示例 `UserData`：

```sh
#!/bin/sh
set -eu

mkdir -p /etc/youth-contest
cat >/etc/youth-contest/bootstrap.env <<'EOF'
DB_HOST=rm-bp144mn785shpf09u.mysql.rds.aliyuncs.com
DB_PORT=3306
DB_USER=contest
DB_PASSWORD=请替换为当前RDS密码
DB_NAME=youth_aviation_contest
EOF
chmod 600 /etc/youth-contest/bootstrap.env
```

这样以后即使 RDS 实例重建、连接地址变化，也只需要更新 ESS 伸缩配置里的 `UserData`，不需要重新制作自定义镜像。

不要在 ESS 节点上执行：

- `--init-db`
- `--seed-demo`

## 本地调试

本地调试会启动：

- `mysql`
- `redis`
- `app`

命令：

```bash
./deploy/release.sh --local
```

这个模式会自动把本机 `.env.instance` 改成：

- `DEPLOY_MODE=local`
- `APP_ROLE=export`
- `STORAGE_DRIVER=local`
- `DB_HOST=mysql`
- `REDIS_HOST=redis`

## 健康检查和入口

- 宿主机 `nginx` 监听 `80`
- 容器 `app` 监听 `127.0.0.1:3001`
- ALB 健康检查建议使用：`GET /healthz`

推荐入口：

- `www.example.com` -> ALB
- `download.example.com` -> 包月 ECS 公网 IP

## 发布后检查

```bash
docker compose --env-file .env -f docker-compose.yml ps
curl http://127.0.0.1:80/healthz
cat .env.instance
```

包月 ECS 正常应看到：

```bash
APP_ROLE=export
APP_WORKERS=6
DB_CONNECTION_LIMIT=8
DEPLOY_MODE=cloud
STORAGE_DRIVER=oss
```

ESS 节点正常应看到：

```bash
APP_ROLE=app
APP_WORKERS=4
DB_CONNECTION_LIMIT=8
DEPLOY_MODE=cloud
STORAGE_DRIVER=oss
```

## 相关文件

- 发布脚本：[release.sh](./release.sh)
- 共享环境模板：[../.env.example](../.env.example)
- 云上环境模板：[templates/env.docker.oss.example](./templates/env.docker.oss.example)
- 本地调试模板：[templates/env.docker.local.example](./templates/env.docker.local.example)
