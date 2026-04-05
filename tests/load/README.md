# 压测脚本

## 1000 并发 OSS 最终提交流程

标准入口：

```bash
bash tests/load/run-oss-submit-1000.sh
```

这个入口会执行以下动作：

1. 检查 `app/mysql/redis` 服务健康状态。
2. 生成压测素材到 `tests/load/fixtures/`：
   - `load-test-report.pdf`：默认 `512 KB`
   - `load-test-proof1.pdf`：默认 `256 KB`
   - `load-test-integrity.pdf`：默认 `256 KB`
   - `load-test-proof2.mp4`：默认 `2 MB`
3. 准备 `1000` 个压测账号。
4. 走完整业务链路：
   - 登录
   - 选择创新设计赛道
   - 进入 `/innovation`
   - 调用 `/api/uploads/sign`
   - 直传 OSS
   - POST `/innovation` 最终提交
5. 归档 `k6` 输出到 `reports/oss-submit-1000-时间戳/`

线上部署建议保持 `宿主机 nginx -> app(cluster workers)` 拓扑，再从公网机器发压测。这样公网入口、会话、应用 worker 和 OSS 直传链路都在同一条真实路径上。

## 单机高可用模型

如果目标不是“同一秒硬扛住 200/1000 人 fresh login”，而是“单机保持高可用，超过能力就提示稍后重试”，推荐启用登录准入保护并使用窗口化压测：

- 服务端：
  - `LOGIN_ADMISSION_ENABLED=true`
  - `LOGIN_MAX_INFLIGHT=64`
  - `LOGIN_RETRY_AFTER_SECONDS=3`
- 行为：
  - 超过单机可承受的登录并发时，`/login` 会直接返回 `503` 和 `Retry-After`
  - 已经拿到登录名额的用户继续完成后续提交
  - 压测端按真实用户方式做退避重试，而不是所有人同一秒只撞一次

这样更适合回答两个问题：

- 单机在高可用前提下能稳定承受多少“正在进行中的登录”
- 一段时间内处理完 `2000` 个学生资料提交总共需要多久

## 常用命令

只准备 1000 个压测账号：

```bash
bash test.sh -type seed-only -num 1000
```

1000 并发，关闭可选视频：

```bash
bash test.sh -type oss-submit -num 1000 -include-video false -max-duration 30m
```

1000 并发，走固定入口并调整等待时间：

```bash
THINK_TIME=0.1 bash tests/load/run-oss-submit-1000.sh
```

## 可调参数

- `NUM`：默认 `1000`
- `THINK_TIME`：默认 `0.2`
- `MAX_DURATION`：默认 `30m`
- `INCLUDE_VIDEO`：默认 `true`
- `REPORT_DIR`：自定义报告目录
- `SCENARIO_MODE`：`per-vu` 或 `shared-iterations`
- `TOTAL_ITERATIONS`：窗口化测试的总用户数
- `LOGIN_RETRY_MAX`
- `LOGIN_RETRY_BACKOFF`
- `FLOW_RETRY_MAX`
- `LOAD_FIXTURE_REPORT_BYTES`
- `LOAD_FIXTURE_PROOF1_BYTES`
- `LOAD_FIXTURE_INTEGRITY_BYTES`
- `LOAD_FIXTURE_VIDEO_BYTES`

## 注意事项

- 当前仓库的 `test.sh` 会优先使用本机 `k6`；如果未安装，会自动回退到 `grafana/k6` Docker 镜像。
- 默认 `BASE_URL=http://127.0.0.1:80` 时，Docker 回退模式会自动改写成 `http://app:3000`，避免打到错误目标。
- 报告输出包括：
  - `summary.json`
  - `report.txt`
  - `k6.log`

## 外部机器公网压测

用于另一台机器直接打线上公网入口，不依赖本地 `docker compose` 服务状态检查，也不会自动造数。

标准入口：

```bash
BASE_URL=http://你的公网地址:80 bash tests/load/run-external-oss-submit-200.sh
```

常用示例：

```bash
BASE_URL=http://你的公网地址:80 bash tests/load/run-external-oss-submit-200.sh
BASE_URL=http://你的公网地址:80 INCLUDE_VIDEO=true bash tests/load/run-external-oss-submit-200.sh
BASE_URL=http://你的公网地址:80 USER_START=202699990001 USER_COUNT=200 bash tests/load/run-external-oss-submit-200.sh
```

模拟 `2000` 个学生在一段时间内陆续重试并完成提交：

```bash
BASE_URL=http://你的公网地址:80 bash tests/load/run-external-oss-submit-2000-window.sh
```

这个入口默认含义是：

- 总学生数 `2000`
- 同时活跃用户上限 `120`
- 登录忙时自动退避重试
- 整个流程允许有限次数重试
- 最终看“全部处理完用了多久”，而不是只看同一秒瞬时登录是否全成功

外部压测机前提：

- 目标服务上的压测账号必须提前准备好
- 默认密码模式是 `last8`
- 需要本机安装 `k6`，或者可用 `docker run grafana/k6`

## 当前建议

在真实公网环境下，如果目标是“尽量让用户最终完成提交”，建议先用窗口化模型看总耗时，再用瞬时并发模型看保护阈值：

- 窗口化模型：测 `2000` 个学生最终多久处理完
- 瞬时并发模型：测单机在 `503 + Retry-After` 保护下能稳定承受多少登录并发
