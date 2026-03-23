# 单 ECS Docker 部署

适用场景：

- 低成本部署
- 业务流程相对简单
- 应用、MySQL、Redis 同机
- 上传文件直传 OSS，ECS 不中转大文件

## 架构

- `app`：Node.js 应用容器
- `mysql`：MySQL 8.4 容器
- `redis`：Redis 7 容器
- `OSS`：阿里云对象存储，浏览器直传

说明：这是单机架构，适合一期上线或成本敏感场景，但存在单点故障。

## 1. ECS 安装 Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo systemctl enable docker
sudo systemctl start docker
```

如果你的环境已安装 Docker Compose 插件，可直接使用 `docker compose`。

## 2. 准备项目

```bash
git clone <your-repo-url>
cd youth-aviation-contest-platform
cp .env.production.example .env.production
```

编辑 `.env.production`，至少改这些值：

- `SESSION_SECRET`
- `DB_PASSWORD`
- `MYSQL_ROOT_PASSWORD`
- `REDIS_PASSWORD`
- `OSS_BUCKET`
- `OSS_ACCESS_KEY_ID`
- `OSS_ACCESS_KEY_SECRET`
- `OSS_ENDPOINT`
- `OSS_INTERNAL_ENDPOINT`

## 3. 首次发布

```bash
./deploy/release.sh
```

脚本会做这几件事：

1. 构建应用镜像
2. 启动 `mysql` 和 `redis`
3. 初始化数据库和测试账号
4. 启动 `app`

## 4. 日常更新

```bash
git pull
./deploy/release.sh
```

## 5. 查看运行状态

```bash
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs -f app
```

## 6. 健康检查

```bash
curl http://127.0.0.1:3000/healthz
```

## 7. Nginx 反向代理

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

## 8. OSS 配置重点

需要为 Bucket 配置 CORS，至少允许：

- `PUT`
- `GET`
- `HEAD`

来源需要放行你的前端域名。

如果 ECS 与 OSS 同地域，建议：

- `OSS_ENDPOINT` 使用浏览器可访问的公网域名
- `OSS_INTERNAL_ENDPOINT` 使用阿里云内网域名

这样浏览器直传仍走公网，ECS 删除/校验 OSS 对象走内网。
