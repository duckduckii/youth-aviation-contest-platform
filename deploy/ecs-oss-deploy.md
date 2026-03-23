# ECS + OSS 部署说明

## 1. ECS 准备

- 安装 Node.js 20+
- 安装 MySQL 客户端（如果数据库使用 RDS，仅用于初始化）
- 准备 Redis（推荐阿里云 Redis）
- 安装 PM2：`npm install -g pm2`
- 建议前置 Nginx/SLB

## 2. 拉取项目

```bash
git clone <your-repo-url>
cd youth-aviation-contest-platform
npm ci --omit=dev
cp .env.example .env
```

## 3. 配置 `.env`

至少修改以下项：

```bash
HOST=0.0.0.0
PORT=3000
SESSION_SECRET=replace-with-a-long-random-string
SESSION_TTL=28800
SESSION_COOKIE_SECURE=true
TRUST_PROXY=true

DB_HOST=<rds-host>
DB_PORT=3306
DB_USER=<db-user>
DB_PASSWORD=<db-password>
DB_NAME=youth_aviation_contest
DB_CONNECTION_LIMIT=30

REDIS_URL=redis://:<password>@<redis-host>:6379/0
REDIS_PREFIX=youth-contest:sess:

STORAGE_DRIVER=oss
OSS_REGION=oss-cn-hangzhou
OSS_BUCKET=<bucket>
OSS_ACCESS_KEY_ID=<ak>
OSS_ACCESS_KEY_SECRET=<sk>
OSS_ENDPOINT=https://<bucket-or-cname>
OSS_INTERNAL_ENDPOINT=<optional-internal-endpoint>
OSS_PREFIX=contest
OSS_SIGNED_URL_EXPIRES=900
OSS_SECURE=true
OSS_CNAME=false
```

## 4. 初始化数据库

```bash
npm run db:init
npm run db:seed
```

## 5. 启动

```bash
pm2 start ecosystem.config.js
pm2 save
```

## 6. 健康检查

```bash
curl http://127.0.0.1:3000/healthz
```

返回 `ok: true` 即可。

## 7. Nginx 反向代理示例

```nginx
server {
  listen 80;
  server_name your-domain.com;

  client_max_body_size 20m;

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

说明：浏览器上传文件时会直传 OSS，大文件流量不会经过 ECS；Nginx 的 `client_max_body_size` 主要限制普通表单和接口请求即可。

补充：生产环境不要再使用内存 Session，当前项目已改为 Redis Session，Redis 不可用时服务会启动失败。
