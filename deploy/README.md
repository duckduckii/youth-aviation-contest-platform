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
  机器本地覆盖文件，由 `./deploy/release.sh` 自动生成，用来区分 `APP_ROLE=export` 和 `APP_ROLE=app`。

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
DEPLOY_MODE=cloud
STORAGE_DRIVER=oss
```

ESS 节点正常应看到：

```bash
APP_ROLE=app
DEPLOY_MODE=cloud
STORAGE_DRIVER=oss
```

## 相关文件

- 发布脚本：[release.sh](./release.sh)
- 共享环境模板：[../.env.example](../.env.example)
- 云上环境模板：[templates/env.docker.oss.example](./templates/env.docker.oss.example)
- 本地调试模板：[templates/env.docker.local.example](./templates/env.docker.local.example)
