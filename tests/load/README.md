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
- `LOAD_FIXTURE_REPORT_BYTES`
- `LOAD_FIXTURE_PROOF1_BYTES`
- `LOAD_FIXTURE_INTEGRITY_BYTES`
- `LOAD_FIXTURE_VIDEO_BYTES`

## 注意事项

- 当前仓库的 `test.sh` 会优先使用本机 `k6`；如果未安装，会自动回退到 `grafana/k6` Docker 镜像。
- 默认 `BASE_URL=http://127.0.0.1:3000` 时，Docker 回退模式会自动改写成 `http://app:3000`，避免打到错误目标。
- 报告输出包括：
  - `summary.json`
  - `report.txt`
  - `k6.log`

## 外部机器公网压测

用于另一台机器直接打线上公网入口，不依赖本地 `docker compose` 服务状态检查，也不会自动造数。

标准入口：

```bash
BASE_URL=http://你的公网地址:3000 bash tests/load/run-external-oss-submit-200.sh
```

常用示例：

```bash
BASE_URL=http://你的公网地址:3000 bash tests/load/run-external-oss-submit-200.sh
BASE_URL=http://你的公网地址:3000 INCLUDE_VIDEO=true bash tests/load/run-external-oss-submit-200.sh
BASE_URL=http://你的公网地址:3000 USER_START=202699990001 USER_COUNT=200 bash tests/load/run-external-oss-submit-200.sh
```

外部压测机前提：

- 目标服务上的压测账号必须提前准备好
- 默认密码模式是 `last8`
- 需要本机安装 `k6`，或者可用 `docker run grafana/k6`

## 已验证结论

同样是 `200` 并发、无视频、同一套脚本，结果如下：

- `public endpoint`：失败
  - `http_req_failed=5.89%`
  - `http_req_duration p95=13901 ms`
- `internal endpoint`：通过
  - `http_req_failed=0.00%`
  - `http_req_duration p95=965 ms`

这说明当前主瓶颈在 `OSS 公网直传链路`，不是业务主链路本身。
