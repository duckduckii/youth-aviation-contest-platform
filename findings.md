# Findings

## Initial Context
- 用户要求把导入改成后端任务，页面可查看进度。
- 用户要求清空所有导入账户信息后重新导入。
- 之前已发现同步导入 2590 行知识赛会超过 Nginx 120 秒超时，但数据库可能最终成功。
- 已修正“不预设比赛方向”时服务端不再按赛事类型自动推断赛道。

## Existing Import Flow
- `src/server.js` POST `/admin/registration-import` currently waits for `registrationImportService.importWorkbook`.
- `importWorkbook` validates the whole workbook, opens one transaction, inserts `registration_import_batches`, then loops rows sequentially.
- New users require `bcrypt.hash(..., 10)` per row, which is the main long-running work.
- `registration_import_batches` currently records only completed results; it can be extended into a persistent job/progress table.
- Existing page `views/admin-registration-import.ejs` renders recent batches and a synchronous result block.
