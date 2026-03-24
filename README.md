# 全国青少年安全与应急科普创新大赛（航模方向）作品提交系统

基于 `Node.js + Express + EJS + MySQL + Redis` 的可运行版本，已实现：

- 账号登录
- 登录后显示当前账号、修改密码、退出登录
- 比赛方向选择（知识类 / 创新设计类），可返回选择页调整
- 赛道状态记忆（再次登录自动进入对应流程）
- 创新设计类四项文件上传与修改（PDF / MP4 格式、大小限制校验）
- 草稿保存与最终提交（最终提交后锁定）
- 存储双模式：本地落盘 / OSS 直传
- Redis Session 存储
- 管理员后台统计看板（报名总览、提交进度、7日趋势、最近动态）
- 诚信承诺书模板下载
- 参考目标站点风格的首页横幅、蓝色主题、卡片化UI

## 1. 推荐部署方式

当前仓库只保留一套部署路径：`Docker Compose` 单机部署，并支持两种存储模式：

- `oss`：浏览器直传阿里云 OSS，ECS 只负责签名和元数据入库
- `local`：文件写入容器挂载卷 `uploads_data`

对应模板文件：

- `deploy/templates/env.docker.oss.example`
- `deploy/templates/env.docker.local.example`

实际发布时统一使用根目录的 `.env.production`，从以上模板中任选一份复制后再修改。

## 2. 快速发布

```bash
cp deploy/templates/env.docker.oss.example .env.production
# 或
# cp deploy/templates/env.docker.local.example .env.production

./deploy/release.sh
```

发布后检查：

```bash
docker compose --env-file .env.production ps
curl http://127.0.0.1:3000/healthz
```

## 3. 演示账号

- 学生测试账号范围：`202600010001` 到 `202600010100`

## 4. 目录结构

```text
.
├── docs/
│   ├── qa/                # 验收问题记录与截图
│   ├── reference/         # 需求文档与参考站点抓取快照
│   └── templates/         # 原始模板与归档资料
├── public/                # 静态资源（样式、脚本、图标、下载模板）
│   └── downloads/         # 前台可下载文件
├── scripts/               # 数据库初始化与演示账号脚本
├── src/
│   ├── middleware/        # 认证中间件
│   ├── services/          # 用户与提交服务
│   ├── utils/             # 密码与文件工具
│   ├── config.js          # 环境配置
│   ├── db.js              # MySQL 连接池
│   └── server.js          # 应用入口
├── views/                 # EJS 页面模板
└── uploads/               # 上传文件目录（按报名号分文件夹）
```

## 5. 关键业务说明

- 最终提交时强制要求以下内容：作品题目、作品研究设计报告（PDF）、其他证明材料1（PDF，<=30MB）、其他证明材料2（MP4，<=100MB）、诚信承诺书（PDF）
- 文件按统一归档规则落盘存储，前台仅展示用户上传文件名。
- 最终提交后状态变为 `SUBMITTED`，页面锁定不允许修改。
- `STORAGE_DRIVER=local` 时，文件保存到服务器本地 `uploads/`
- `STORAGE_DRIVER=oss` 时，浏览器直传 OSS，ECS 只负责签名和元数据入库
- Session 统一存储在 Redis，支持后续多实例部署

## 6. 部署文档

- 统一部署手册见：[deploy/ecs-single-node-docker.md](/Users/yuqi/Workspace/youth-aviation-contest-platform/deploy/ecs-single-node-docker.md)
- `oss` 模板：[deploy/templates/env.docker.oss.example](/Users/yuqi/Workspace/youth-aviation-contest-platform/deploy/templates/env.docker.oss.example)
- `local` 模板：[deploy/templates/env.docker.local.example](/Users/yuqi/Workspace/youth-aviation-contest-platform/deploy/templates/env.docker.local.example)
