# Findings & Decisions

## Requirements
- Research how repeated user registration numbers are handled when importing multiple Excel files.
- Cover both duplicates inside one workbook and duplicates that already exist from previous imports.
- Do not change code or database state.

## Research Findings
- `users.registration_no` is defined as `VARCHAR(64) NOT NULL UNIQUE`, so the database treats registration number as the account identity.
- `validateRows()` uses an in-memory `seen` map for one workbook. If a registration number appears twice in the same Excel file, validation records an error like `与第 X 行报名号重复`; when any validation error exists, `importWorkbook()` returns `ok: false` before opening the DB transaction, so nothing from that workbook is inserted or updated.
- Before writing a valid workbook, `getExistingUsersMap()` queries existing `users` by all registration numbers in the workbook. Rows already present in DB are updated; missing rows are inserted.
- Existing-user update overwrites imported profile fields: student name, school, participation mode, mobile, season, region, event, group, grade, class, delivery method, channel, team, mentor, review status, external submit/review times, `last_import_batch_id`, and `last_imported_at`.
- Existing-user update does not update `password_hash`; existing account passwords are preserved.
- Existing-user update writes `direction` as `existing.direction || row.payload.direction`, so a non-empty existing direction is preserved. If the existing user has no direction, import can fill it from the Excel event name or forced direction.
- New-user insert creates the password hash from `initialPassword(registrationNo)`, which is the last 8 characters of the registration number.
- The admin import form has an optional `forcedDirection`; if selected, it is passed into `importWorkbook()` and used in payload generation. This matters for new users and existing users whose `direction` is still null.
- The five Excel files have no duplicate registration numbers inside any single file.
- Across the five Excel files there are 3,065 data rows but only 2,676 unique registration numbers, meaning 389 registration numbers appear in more than one file.
- Pair overlaps found: `1781164143558.xlsx` overlaps `6.15只开通账号.xlsx` by 1 account; `6.15只开通账号.xlsx` overlaps `只开通账号（6.12）.xlsx` by 83 accounts; `报名知识赛（6.12）.xlsx` overlaps `长安中学报名列表 .xlsx` by 305 accounts.
- `长安中学报名列表 .xlsx` appears to be a full subset of `报名知识赛（6.12）.xlsx` by registration number.
- Current DB already contains 305 of the 2,676 unique registration numbers in these Excel files. All 305 have `direction = KNOWLEDGE` and `last_import_batch_id = 11`.
- Recent import batch `11` is `长安中学报名列表 .xlsx`, forced direction `KNOWLEDGE`, total/success/inserted rows all 305.
- If importing the five files now in `ls` order, based on current DB state and registration-number overlap only: `1781164143558.xlsx` inserts 1, updates 0; `6.15只开通账号.xlsx` inserts 85, updates 1; `只开通账号（6.12）.xlsx` inserts 0, updates 83; `报名知识赛（6.12）.xlsx` inserts 2,285, updates 305; `长安中学报名列表 .xlsx` inserts 0, updates 305. Total inserts 2,371 and updates 694.
- If starting from an empty DB and importing the same five files in that order, total inserts would be 2,676 and updates 389.
- Operational risk: importing `报名知识赛（6.12）.xlsx` without forced knowledge direction would still keep the existing 305 accounts as `KNOWLEDGE`, but it would overwrite their imported metadata from the larger file, including `event_name` from the Excel row.
- Residual uncertainty: the conclusions assume normal sequential admin imports. If two overlapping files are imported concurrently, the service is not using an atomic upsert; both transactions could decide a registration number is missing and race on the DB unique key.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Treat import behavior as code-level research | The user asked what will happen; inspecting the service is safer than running a real import against the database. |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| Concurrent duplicate import behavior not exercised | Documented as a residual risk because user asked about multi-file behavior and the normal UI flow is sequential uploads. |

## Resources
-
