# 全国青少年安全与应急科普创新大赛（航模方向）作品提交系统

基于 `Node.js + Express + EJS + MySQL + Redis` 的作品提交平台，覆盖报名登录、赛道选择、作品上传、最终提交和管理员统计看板，支持 `本地存储` 与 `阿里云 OSS 直传` 两种文件存储模式。

## 功能概览

- 账号登录、修改密码、退出登录
- 知识类 / 创新设计类赛道选择与状态记忆
- 创新设计类多文件上传、草稿保存、最终提交锁定
- 诚信承诺书模板下载
- 管理员后台总览、提交进度、近 7 日趋势、最近动态
- Redis Session 存储
- 文件存储双模式：
  - `local`：落盘到 Docker 卷 `uploads_data`
  - `oss`：浏览器直传 OSS，应用仅负责签名和元数据入库

## 技术栈

- 应用：`Node.js`、`Express`、`EJS`
- 数据：`MySQL 8`、`Redis 7`
- 部署：`Docker Compose` 单机部署
- 对象存储：`Aliyun OSS`（可选）

## 推荐部署方式

当前仓库默认只维护一套生产部署路径：`Docker Compose` 单机部署。

```bash
cp deploy/templates/env.docker.oss.example .env.production
# 或
# cp deploy/templates/env.docker.local.example .env.production

./deploy/release.sh
```

发布后可用以下命令检查状态：

```bash
docker compose --env-file .env.production ps
curl http://127.0.0.1:3000/healthz
```

健康检查返回示例：

```json
{"ok":true,"storageDriver":"oss","timestamp":"2026-03-24T00:00:00.000Z"}
```

## 演示账号

首次执行 `./deploy/release.sh` 时会自动初始化数据库并写入演示账号：

- 学生账号范围：`202600010001` 到 `202600010100`
- 学生账号默认密码：报名号后 8 位
- 管理员账号：`admin / admin`
- 流程测试账号：`test / test`

## 目录结构

```text
.
├── deploy/               # 部署脚本、环境模板、图文部署手册
├── docs/                 # 需求文档、问题记录等补充材料
├── public/               # 静态资源与下载模板
├── scripts/              # 数据库初始化、演示账号脚本
├── src/                  # 应用源码
├── views/                # EJS 模板
└── uploads/              # 本地存储模式下的上传目录
```

## 文档索引

- 部署入口索引：[deploy/README.md](./deploy/README.md)
- 图文部署手册：[deploy/youth-aviation-contest-platform部署手册.md](./deploy/youth-aviation-contest-platform部署手册.md)
- 单机 Docker 手册：[deploy/ecs-single-node-docker.md](./deploy/ecs-single-node-docker.md)
- OSS 环境模板：[deploy/templates/env.docker.oss.example](./deploy/templates/env.docker.oss.example)
- 本地存储模板：[deploy/templates/env.docker.local.example](./deploy/templates/env.docker.local.example)
- 需求文档：[docs/reference/需求文档.md](./docs/reference/需求文档.md)

## 关键业务约束

- 创新设计类最终提交时，必须填写作品题目并上传：
  - 作品研究设计报告（PDF）
  - 其他证明材料 1（PDF）
  - 诚信承诺书（PDF）
- 其他证明材料 2 为可选文件，格式为 `MP4`
- 最终提交后状态变为 `SUBMITTED`，页面锁定，不允许再次修改
- `STORAGE_DRIVER=local` 时文件写入服务器本地
- `STORAGE_DRIVER=oss` 时文件直传 OSS
