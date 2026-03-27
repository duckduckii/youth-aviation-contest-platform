# 单 ECS Docker 部署手册

目标：只保留一套部署方式，即 `Docker Compose` 单机部署，并支持两种存储模式：

- `oss`：浏览器直传阿里云 OSS
- `local`：文件写入容器挂载卷 `uploads_data`

## 1. 架构说明

- `app`：Node.js 应用容器
- `mysql`：MySQL 8.4 容器
- `redis`：Redis 7 容器
- `nginx`：宿主机安装，由 `deploy/release.sh` 自动安装和下发配置
- `oss`：仅在 `STORAGE_DRIVER=oss` 时启用

说明：这是单机架构，适合一期上线、流程已稳定、预算有限的场景，但存在单点故障。

## 2. 上线前资源清单

部署前先准备：

- 1 台阿里云 ECS
- 1 个阿里云 OSS Bucket（仅 `oss` 模式需要）
- 1 个 RAM 用户及 AccessKey（仅 `oss` 模式需要）
- 1 个域名和 HTTPS 证书（推荐）
- 当前仓库访问权限

## 3. 新建 ECS

建议最少配置：

- 地域：尽量与 OSS Bucket 保持同地域
- 操作系统：`Ubuntu 22.04 LTS` 或你已熟悉的 Linux 发行版
- 安全组放行：
  - `22/tcp`：SSH
  - `80/tcp`：HTTP
  - `443/tcp`：HTTPS

如果前期调试需要直接访问应用，也可以临时放行 `3000/tcp`。当前默认拓扑是宿主机 `nginx` 监听 `3000`，再反向代理到容器内 `127.0.0.1:3001`。

## 4. ECS 安装基础环境

### 4.1 安装 Git

Ubuntu / Debian：

```bash
sudo apt-get update
sudo apt-get install -y git
```

### 4.2 安装 Docker Engine

```bash
curl -fsSL https://get.docker.com | sh
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker $USER
```

重新登录一次 SSH，使 `docker` 用户组生效。

### 4.3 安装 Docker Compose 插件

先检查：

```bash
docker compose version
```

如果命令不存在，在 Ubuntu / Debian 安装：

```bash
sudo apt-get update
sudo apt-get install -y docker-compose-plugin
docker compose version
```

## 5. 新建 OSS 资源（仅 oss 模式）

### 5.1 新建 Bucket

建议配置：

- Bucket 名称：例如 `youth-aviation-contest-prod`
- 地域：与 ECS 保持一致
- 读写权限：`私有`
- 冗余类型：默认即可

Bucket 创建完成后，需要记录：

- `OSS_BUCKET`：Bucket 名称
- `OSS_REGION`：Bucket 所在地域，例如 `oss-cn-hangzhou`
- `OSS_ENDPOINT`：浏览器可访问的公网 Endpoint 或绑定后的自定义域名
- `OSS_INTERNAL_ENDPOINT`：同地域 ECS 访问 OSS 的内网 Endpoint

说明：

- `OSS_ENDPOINT` 给浏览器直传使用，必须是公网可访问地址
- `OSS_INTERNAL_ENDPOINT` 给 ECS 服务端校验和删除对象使用，可降低同地域流量成本

### 5.2 新建 RAM 用户

建议新建一个专用 RAM 用户，例如 `contest-oss-uploader`，只给这一个项目用。

最少需要的对象权限应覆盖：

- `PutObject`
- `GetObject`
- `HeadObject`
- `DeleteObject`

权限范围建议只限定到本项目使用的 Bucket，避免直接给整账号过大权限。

RAM 用户创建后：

- 开启 `OpenAPI 调用访问`
- 创建 `AccessKey`
- 记录 `AccessKey ID` 和 `AccessKey Secret`

它们分别对应：

- `OSS_ACCESS_KEY_ID`
- `OSS_ACCESS_KEY_SECRET`

### 5.3 配置 Bucket CORS

在 Bucket 的 CORS 规则中，至少增加 1 条规则：

- 来源：你的前端访问域名
- 方法：`PUT`、`GET`、`HEAD`
- Allowed Headers：`*`
- Expose Headers：`ETag,x-oss-request-id`
- Max Age：`3600`

如果你还在调试阶段，可临时加入：

- `http://你的域名`
- `https://你的域名`
- `http://ECS公网IP:3000`

正式上线后，应删除临时调试来源，只保留正式域名。

## 6. 拉取项目

```bash
git clone <your-repo-url>
cd youth-aviation-contest-platform
```

## 7. 生成 `.env.production`

本仓库只保留两种 Docker 模板：

- `deploy/templates/env.docker.oss.example`
- `deploy/templates/env.docker.local.example`

### 7.1 OSS 模式

```bash
cp deploy/templates/env.docker.oss.example .env.production
```

### 7.2 local 模式

```bash
cp deploy/templates/env.docker.local.example .env.production
```

## 8. `.env.production` 参数来源说明

下表对应当前生产配置文件中的全部参数。

| 参数 | 含义 | 典型来源 |
| --- | --- | --- |
| `HOST` | 应用监听地址 | 固定写 `0.0.0.0` |
| `PORT` | 应用端口 | 固定写 `3000` |
| `SESSION_SECRET` | 会话签名密钥 | 用 `openssl rand -hex 32` 生成 |
| `SESSION_TTL` | Session 过期秒数 | 常用 `28800`（8 小时） |
| `SESSION_COOKIE_SECURE` | Cookie 仅 HTTPS 发送 | 正式 HTTPS 环境写 `true` |
| `TRUST_PROXY` | 信任反向代理头 | ECS 前有 Nginx / SLB 时写 `true` |
| `DB_HOST` | MySQL 主机 | Docker 单机部署固定写 `mysql` |
| `DB_PORT` | MySQL 端口 | 固定写 `3306` |
| `DB_USER` | MySQL 用户 | 推荐写 `contest_app`，避免应用直接使用 `root` |
| `DB_PASSWORD` | 应用访问 MySQL 密码 | 你自行设置的数据库密码 |
| `DB_NAME` | 数据库名 | 推荐 `youth_aviation_contest` |
| `DB_CONNECTION_LIMIT` | MySQL 连接池大小 | 常用 `20` 或 `30` |
| `MYSQL_ROOT_PASSWORD` | MySQL root 密码 | 你自行设置的 root 密码 |
| `REDIS_URL` | Redis 完整连接串 | 单机 Compose 可留空 |
| `REDIS_HOST` | Redis 主机 | Docker 单机部署固定写 `redis` |
| `REDIS_PORT` | Redis 端口 | 固定写 `6379` |
| `REDIS_PASSWORD` | Redis 密码 | 你自行设置的强密码 |
| `REDIS_DB` | Redis DB 库号 | 常用 `0` |
| `REDIS_PREFIX` | Session key 前缀 | 推荐 `youth-contest:sess:` |
| `STORAGE_DRIVER` | 存储模式 | `oss` 或 `local` |
| `OSS_REGION` | OSS 地域 | Bucket 地域，例如 `oss-cn-hangzhou` |
| `OSS_BUCKET` | Bucket 名称 | OSS 控制台中的 Bucket 名称 |
| `OSS_ACCESS_KEY_ID` | RAM AccessKey ID | RAM 用户 AccessKey |
| `OSS_ACCESS_KEY_SECRET` | RAM AccessKey Secret | RAM 用户 AccessKey |
| `OSS_ENDPOINT` | 公网 OSS 地址 | Bucket 公网 Endpoint 或自定义域名 |
| `OSS_INTERNAL_ENDPOINT` | 内网 OSS 地址 | Bucket 内网 Endpoint |
| `OSS_PREFIX` | 对象目录前缀 | 自定义，例如 `contest` |
| `OSS_SIGNED_URL_EXPIRES` | 直传签名有效期 | 常用 `900` 秒 |
| `OSS_SECURE` | 是否使用 HTTPS | 正式环境写 `true` |
| `OSS_CNAME` | 是否使用自定义 CNAME | 仅绑定自定义域名时设 `true` |
| `MAX_REPORT_MB` | 研究设计报告限制 | 默认 `30` |
| `MAX_PROOF1_MB` | 证明材料 1 限制 | 默认 `30` |
| `MAX_PROOF2_MB` | 证明材料 2 限制 | 默认 `100` |
| `MAX_INTEGRITY_MB` | 诚信承诺书限制 | 默认 `30` |

补充：

- `local` 模式下，所有 `OSS_*` 参数可以保留空值
- `oss` 模式下，`OSS_BUCKET`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET` 必须填写
- 如果 `OSS_ENDPOINT` 已绑定自定义域名，且 SDK 以 CNAME 方式访问，再把 `OSS_CNAME` 改为 `true`

## 9. 首次发布

```bash
./deploy/release.sh
```

当前 `release.sh` 会自动完成：

- 宿主机 sysctl 参数应用
- 宿主机 `nginx` 安装/更新与配置下发
- `mysql`、`redis`、`app` 容器启动
- 初始化数据库与演示账号

脚本会自动完成：

1. 构建应用镜像
2. 启动 `mysql` 和 `redis`
3. 初始化数据库和测试账号
4. 启动 `app`

## 10. 日常更新

```bash
git pull
./deploy/release.sh
```

## 11. 查看运行状态

```bash
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs -f app
docker compose --env-file .env.production logs -f mysql
docker compose --env-file .env.production logs -f redis
```

## 12. 健康检查

```bash
curl http://127.0.0.1:3000/healthz
```

返回 `ok: true` 即表示应用已启动。

## 13. Nginx 反向代理

```nginx
server {
  listen 80;
  server_name your-domain.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

建议：

- 由 Nginx 处理 HTTPS 证书
- `SESSION_COOKIE_SECURE=true` 时，外部访问应走 HTTPS
- 正式环境不要长期开 `3000` 公网端口

## 14. 存储模式切换

### 切换到 OSS

- 使用 `deploy/templates/env.docker.oss.example` 生成新的 `.env.production`
- 填写所有 `OSS_*` 参数
- 执行 `./deploy/release.sh`

### 切换到 local

- 使用 `deploy/templates/env.docker.local.example` 生成新的 `.env.production`
- 执行 `./deploy/release.sh`

文件会写入 Docker 卷 `uploads_data`，而不是 OSS。
