# Progress

## 2026-06-15
- Created planning files for async import task.
- Next: clear database and inspect current import implementation.
- Cleared existing imported data with `scripts/clear-db.js`.
- Verified counts: users=1, submissions=0, export_batches=0, registration_import_batches=0; remaining user is `admin`.
- Extended `registration_import_batches` schema logic with status/progress/error fields.
- Replaced sync import service path with `startImportJob`, background row processing, and recent-batch status mapping.
- Added `/admin/registration-import/status` route and changed import POST to start a job instead of waiting for completion.
- Updated `views/admin-registration-import.ejs` to show batch status/progress and poll every 3 seconds while a task is running.
- Verified short background import with `未选择_去重合并.xlsx`: batch progressed 0/86 to SUCCESS 86/86 and imported accounts had `direction = NULL`.
- Cleared database again after verification; remaining data is only `admin`.
- Rebuilt and restarted Docker app with `docker compose up -d --build app`.
- Verified container health from inside container and with `curl --noproxy '*' http://127.0.0.1:3001/healthz`.
- Final database counts: users=1, submissions=0, export_batches=0, registration_import_batches=0.
