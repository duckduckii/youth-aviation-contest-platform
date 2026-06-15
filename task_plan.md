# 导入后台任务改造计划

## Goal
将报名 Excel 导入从同步请求改为后端后台任务，页面可查看导入进度；同时清空现有导入账户数据，方便重新导入。

## Phases

### Phase 1: 清空现有导入数据
Status: complete
- 执行现有清库脚本
- 复核业务表记录数

### Phase 2: 理解现有导入流程
Status: complete
- 查看导入路由、服务层、页面渲染和现有批次表
- 确定最小兼容改造方案

### Phase 3: 实现后台导入任务
Status: complete
- 新增导入任务状态字段和进度字段
- POST 导入接口只创建任务并立即返回
- 后端异步处理 Excel，逐行更新进度和最终结果

### Phase 4: 页面进度展示
Status: complete
- 增加任务状态查询接口
- 页面轮询最近任务，展示进行中/成功/失败、进度和错误

### Phase 5: 验证与服务重启
Status: complete
- 语法检查和关键路径手动验证
- 重启服务或说明需要重启
- 复核数据库清空状态

## Decisions
- “不预设比赛方向”应保持 `direction = NULL`，用户登录后自行选择。
- 后台任务优先采用数据库批次表持久化进度，避免 Node 进程内存状态丢失后页面看不到结果。

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| EJS render test failed with `isAdmin is not defined` | Rendered import page with incomplete mock locals | Re-run render test with `isAdmin: true` |

## Final Verification
- `node --check src/services/registration-import-service.js` passed.
- `node --check src/server.js` passed.
- Import page EJS render test passed with mock admin locals.
- Short background import test completed successfully and showed progress.
- Database was cleared again after the test.
- Docker app container was rebuilt and restarted; container status is healthy.
