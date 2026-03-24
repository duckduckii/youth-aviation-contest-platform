# 部署文档索引

`deploy/` 目录统一收敛为 `Docker Compose` 单机部署方案，按用途建议这样阅读：

- 图文操作版：[youth-aviation-contest-platform部署手册.md](./youth-aviation-contest-platform部署手册.md)
  - 适合第一次在阿里云 ECS + OSS 上完整部署
  - 包含控制台截图、RAM 用户和 OSS CORS 配置步骤
- 参数说明版：[ecs-single-node-docker.md](./ecs-single-node-docker.md)
  - 适合运维交接、快速查阅环境变量和 Nginx 反向代理配置

## 相关文件

- 发布脚本：[release.sh](./release.sh)
- Ubuntu Docker 安装脚本：[install-docker-ubuntu.sh](./install-docker-ubuntu.sh)
- OSS 模板：[templates/env.docker.oss.example](./templates/env.docker.oss.example)
- Local 模板：[templates/env.docker.local.example](./templates/env.docker.local.example)

## 最短发布路径

```bash
git clone <your-repo-url>
cd youth-aviation-contest-platform

cp deploy/templates/env.docker.oss.example .env.production
# 或 cp deploy/templates/env.docker.local.example .env.production

./deploy/release.sh
```

## 发布后检查

```bash
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs -f app
curl http://127.0.0.1:3000/healthz
```
