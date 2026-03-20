# 全国青少年安全与应急科普创新大赛（航模方向）作品提交系统

基于 `Node.js + Express + EJS + MySQL` 的可运行版本，已实现：

- 账号登录（账号=报名号，初始密码=报名号后8位）
- 登录后显示当前账号、修改密码、退出登录
- 比赛方向选择（知识类 / 创新设计类），确认后不可更改
- 赛道状态记忆（再次登录自动进入对应流程）
- 创新设计类四项文件上传与修改（PDF / MP4 格式、大小限制校验）
- 草稿保存与最终提交（最终提交后锁定）
- 诚信承诺书模板下载
- 参考目标站点风格的首页横幅、蓝色主题、卡片化UI

## 1. 环境要求

- Node.js 20+（当前项目在 Node 22 测试）
- MySQL 8/9

## 2. 安装 MySQL（macOS，Homebrew）

```bash
brew install mysql
brew services start mysql
```

如果你的 root 用户需要密码，请在 `.env` 中配置 `DB_PASSWORD`。

## 3. 初始化项目

```bash
cp .env.example .env
npm install
npm run db:prepare
```

`db:prepare` 会自动：

- 创建数据库（默认：`youth_aviation_contest`）
- 创建 `users`、`submissions` 两张表
- 写入演示账号

## 4. 启动

```bash
npm run dev
```

浏览器打开：

- `http://localhost:3000`

## 5. 演示账号

- `202600010001` / `00010001`
- `202600010002` / `00010002`
- `202600010003` / `00010003`

## 6. 目录结构

```text
.
├── public/                # 静态资源（样式、脚本、参考图标与横幅）
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

## 7. 关键业务说明

- 最终提交时强制要求：
  - 作品题目
  - 作品研究设计报告（PDF）
  - 其他证明材料1（PDF，<=30MB）
  - 其他证明材料2（MP4，<=100MB）
  - 诚信承诺书（PDF）
- 文件命名规则在系统中按“作品题目”生成存储名展示。
- 最终提交后状态变为 `SUBMITTED`，页面锁定不允许修改。

