const fs = require('fs/promises');
const path = require('path');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const { RedisStore } = require('connect-redis');

const config = require('./config');
const { ensureAuth, ensureGuest } = require('./middleware/auth');
const { TRACKS, TRACK_LABELS, SUBMISSION_STATUS } = require('./constants');
const userService = require('./services/user-service');
const submissionService = require('./services/submission-service');
const adminDashboardService = require('./services/admin-dashboard-service');
const exportBatchService = require('./services/export-batch-service');
const { runExportBatch, runTailExport } = require('./services/export-batch-runner-service');
const storageService = require('./services/storage-service');
const { createRedisClient, ensureRedisConnected } = require('./services/redis-service');
const {
  buildSessionUser,
  readSessionUser,
  writeSessionUser,
  clearSessionUser,
} = require('./utils/session-user');
const {
  readSessionSubmission,
  writeSessionSubmission,
  clearSessionSubmission,
} = require('./utils/session-submission');
const {
  sanitizeWorkTitle,
  extOf,
  ensureDir,
  buildStoredName,
  buildPhysicalName,
} = require('./utils/file-helpers');
const {
  buildAuthCookieValue,
  verifyAuthCookieValue,
} = require('./utils/auth-cookie');

const app = express();

const FILE_RULES = {
  report: {
    key: 'report',
    inputName: 'reportFile',
    label: '作品研究设计报告',
    ext: '.pdf',
    maxMb: config.upload.maxReportMb,
    required: true,
  },
  proof1: {
    key: 'proof1',
    inputName: 'proofMaterial1File',
    label: '其他证明材料1',
    ext: '.pdf',
    maxMb: config.upload.maxProof1Mb,
    required: true,
  },
  proof2: {
    key: 'proof2',
    inputName: 'proofMaterial2File',
    label: '其他证明材料2',
    ext: '.mp4',
    maxMb: config.upload.maxProof2Mb,
    required: false,
  },
  integrity: {
    key: 'integrity',
    inputName: 'integrityLetterFile',
    label: '诚信承诺书',
    ext: '.pdf',
    maxMb: config.upload.maxIntegrityMb,
    required: true,
  },
};

const ALL_RULES = Object.values(FILE_RULES);
const MAX_UPLOAD_MB = Math.max(...ALL_RULES.map((r) => r.maxMb));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_MB * 1024 * 1024,
  },
});

const uploadFields = upload.fields(
  ALL_RULES.map((rule) => ({ name: rule.inputName, maxCount: 1 })),
);
const INTEGRITY_TEMPLATE_PATH = path.join(process.cwd(), 'public', 'downloads', '诚信承诺书模板.pdf');

function innovationUploadMiddleware(req, res, next) {
  return uploadFields(req, res, next);
}

function isAdminUser(user) {
  return Boolean(user && user.registration_no === 'admin');
}

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) {
    return cookies;
  }

  for (const part of String(cookieHeader).split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function authCookieOptions() {
  return {
    httpOnly: true,
    secure: config.session.cookieSecure,
    sameSite: config.session.cookieSameSite,
    maxAge: config.redis.sessionTtl * 1000,
    path: '/',
  };
}

function readAuthCookieUser(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const rawValue = cookies[config.session.authCookieName];
  return verifyAuthCookieValue(rawValue, config.app.sessionSecret);
}

function writeAuthCookie(res, user) {
  const snapshot = buildSessionUser(user);
  if (!snapshot) {
    return;
  }

  const value = buildAuthCookieValue(snapshot, config.app.sessionSecret, config.redis.sessionTtl);
  res.cookie(config.session.authCookieName, value, authCookieOptions());
}

function clearAuthCookie(res) {
  res.clearCookie(config.session.authCookieName, {
    httpOnly: true,
    secure: config.session.cookieSecure,
    sameSite: config.session.cookieSameSite,
    path: '/',
  });
}

function saveSession(req) {
  if (!req?.session) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function consumeFlash(req) {
  const flash = req.session.flash || null;
  delete req.session.flash;
  return flash;
}

function syncSubmissionSnapshot(req, submission) {
  if (!submission) {
    clearSessionSubmission(req);
    return null;
  }
  return writeSessionSubmission(req, submission);
}

function toBytes(mb) {
  return mb * 1024 * 1024;
}

function validateUploadedFile(file, rule) {
  const ext = extOf(file.originalname);
  if (ext !== rule.ext) {
    return `${rule.label}仅支持${rule.ext.toUpperCase()}文件`;
  }

  if (file.size > toBytes(rule.maxMb)) {
    return `${rule.label}大小不能超过${rule.maxMb}MB`;
  }

  return null;
}

function normalizeOriginalName(value) {
  if (!value) return '';
  if (/[\u4e00-\u9fff]/.test(value)) return value;

  try {
    const decoded = Buffer.from(value, 'latin1').toString('utf8');
    if (decoded.includes('�')) return value;
    if (/[\u4e00-\u9fff]/.test(decoded)) return decoded;
    return value;
  } catch (error) {
    return value;
  }
}

function resolveDisplayFileName(submission, prefix) {
  const originalName = normalizeOriginalName(submission[`${prefix}_original_name`]);
  if (originalName) {
    return originalName;
  }

  if (submission[`${prefix}_stored_name`]) {
    return submission[`${prefix}_stored_name`];
  }

  if (submission[`${prefix}_file_path`]) {
    return path.basename(submission[`${prefix}_file_path`]);
  }

  return '';
}

function buildFileColumns(prefix, filePath, originalName, storedName, fileSize) {
  return {
    [`${prefix}_file_path`]: filePath,
    [`${prefix}_original_name`]: originalName,
    [`${prefix}_stored_name`]: storedName,
    [`${prefix}_file_size`]: fileSize,
    [`${prefix}_uploaded_at`]: new Date(),
  };
}

function displayRequiredLabel(rule) {
  if (rule.key === 'proof1') {
    return '其他证明材料';
  }
  return rule.label;
}

function parseUploadedFilesPayload(raw) {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch (error) {
    return {};
  }
}

function formatBytes(value) {
  const size = Number(value) || 0;
  if (size <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let current = size;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  const digits = current >= 100 || index === 0 ? 0 : current >= 10 ? 1 : 2;
  return `${current.toFixed(digits)} ${units[index]}`;
}

function logRequest(req, res, startedAt) {
  if (!config.app.requestLogEnabled || req.path === '/healthz') {
    return;
  }

  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  const level = durationMs >= config.app.requestLogSlowMs || res.statusCode >= 500 ? 'warn' : 'info';
  const sessionUserId = req.session?.userId || '-';
  const contentLength = res.getHeader('content-length') || '-';

  console[level](
    [
      '[http]',
      req.method,
      req.originalUrl,
      `status=${res.statusCode}`,
      `duration_ms=${durationMs.toFixed(1)}`,
      `user_id=${sessionUserId}`,
      `ip=${req.ip || req.socket?.remoteAddress || '-'}`,
      `bytes=${contentLength}`,
    ].join(' '),
  );
}

function hasAllRequiredFiles(submission) {
  for (const rule of ALL_RULES) {
    if (!rule.required) continue;
    if (!submission[`${rule.key}_file_path`]) {
      return false;
    }
  }
  return true;
}

function missingRequiredLabels(submission) {
  return ALL_RULES
    .filter((rule) => rule.required && !submission[`${rule.key}_file_path`])
    .map((rule) => displayRequiredLabel(rule));
}

async function ensureTrack(req, res, next, expectedTrack) {
  if (!req.currentUser) return res.redirect('/login');
  if (isAdminUser(req.currentUser)) return res.redirect('/admin/dashboard');

  if (!req.currentUser.direction) {
    return res.redirect('/select-direction');
  }

  if (req.currentUser.direction !== expectedTrack) {
    return res.redirect('/portal');
  }

  return next();
}

function ensureAdmin(req, res, next) {
  if (!isAdminUser(req.currentUser)) {
    setFlash(req, 'error', '仅管理员可访问统计看板');
    return res.redirect('/portal');
  }
  return next();
}

async function hasSubmittedInnovation(userId) {
  const submission = await submissionService.getByUserId(userId);
  return Boolean(submission && submission.status === SUBMISSION_STATUS.SUBMITTED);
}

async function canChangeDirection(user) {
  if (!user) return false;
  if (!user.direction) {
    return true;
  }
  if (user.direction === TRACKS.KNOWLEDGE) {
    return false;
  }
  return !(await hasSubmittedInnovation(user.id));
}

app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));
if (config.app.trustProxy) {
  app.set('trust proxy', 1);
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
const redisClient = createRedisClient();
const redisStore = new RedisStore({
  client: redisClient,
  prefix: config.redis.prefix,
  ttl: config.redis.sessionTtl,
  disableTouch: config.redis.disableTouch,
});

app.use(
  session({
    store: redisStore,
    secret: config.app.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.session.cookieSecure,
      sameSite: config.session.cookieSameSite,
      maxAge: config.redis.sessionTtl * 1000,
    },
  }),
);

app.use('/public', express.static(path.join(process.cwd(), 'public')));

app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    logRequest(req, res, startedAt);
  });
  next();
});

app.use((req, res, next) => {
  req.authCookieUser = readAuthCookieUser(req);
  next();
});

app.use(async (req, res, next) => {
  res.locals.flash = consumeFlash(req);
  res.locals.currentUser = null;
  res.locals.isAdmin = false;
  res.locals.trackLabels = TRACK_LABELS;

  if (!req.session.userId && req.authCookieUser) {
    req.session.userId = req.authCookieUser.id;
    writeSessionUser(req, req.authCookieUser);
  }

  const sessionUser = readSessionUser(req) || req.authCookieUser;
  if (!req.session.userId && !sessionUser) {
    return next();
  }

  if (sessionUser) {
    req.currentUser = sessionUser;
    res.locals.currentUser = sessionUser;
    res.locals.isAdmin = isAdminUser(sessionUser);
    return next();
  }

  try {
    const user = await userService.findById(req.session.userId);
    if (!user) {
      clearSessionUser(req);
      clearSessionSubmission(req);
      clearAuthCookie(res);
      req.session.destroy(() => {});
      return res.redirect('/login');
    }

    const snapshot = writeSessionUser(req, user);
    writeAuthCookie(res, snapshot);
    req.currentUser = snapshot;
    res.locals.currentUser = snapshot;
    res.locals.isAdmin = isAdminUser(snapshot);
    return next();
  } catch (error) {
    return next(error);
  }
});

app.get('/', (req, res) => {
  if (!req.currentUser) {
    return res.redirect('/login');
  }
  return res.redirect('/portal');
});

app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    storageDriver: config.storage.driver,
    timestamp: new Date().toISOString(),
  });
});

app.get('/login', ensureGuest, (req, res) => {
  res.render('login', {
    pageTitle: '登录',
  });
});

app.post('/login', ensureGuest, async (req, res) => {
  const registrationNo = (req.body.registrationNo || '').trim();
  const password = (req.body.password || '').trim();

  if (!registrationNo || !password) {
    setFlash(req, 'error', '请输入报名号和密码');
    return res.redirect('/login');
  }

  try {
    const user = await userService.verifyLogin(registrationNo, password);
    if (!user) {
      setFlash(req, 'error', '报名号或密码错误');
      return res.redirect('/login');
    }

    req.session.userId = user.id;
    writeSessionUser(req, user);
    writeAuthCookie(res, user);
    await saveSession(req);
    return res.redirect('/portal');
  } catch (error) {
    setFlash(req, 'error', `登录失败：${error.message}`);
    await saveSession(req);
    return res.redirect('/login');
  }
});

app.post('/logout', ensureAuth, (req, res) => {
  clearAuthCookie(res);
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.get('/change-password', ensureAuth, (req, res) => {
  res.render('change-password', {
    pageTitle: '修改密码',
  });
});

app.post('/change-password', ensureAuth, async (req, res) => {
  const oldPassword = (req.body.oldPassword || '').trim();
  const newPassword = (req.body.newPassword || '').trim();
  const confirmPassword = (req.body.confirmPassword || '').trim();

  if (!oldPassword || !newPassword || !confirmPassword) {
    setFlash(req, 'error', '请完整填写旧密码、新密码、确认密码');
    return res.redirect('/change-password');
  }

  if (newPassword.length < 8) {
    setFlash(req, 'error', '新密码至少8位');
    return res.redirect('/change-password');
  }

  if (newPassword !== confirmPassword) {
    setFlash(req, 'error', '两次输入的新密码不一致');
    return res.redirect('/change-password');
  }

  try {
    const verified = await userService.verifyLogin(req.currentUser.registration_no, oldPassword);
    if (!verified) {
      setFlash(req, 'error', '旧密码错误');
      return res.redirect('/change-password');
    }

    await userService.changePassword(req.currentUser.id, newPassword);
    setFlash(req, 'success', '密码修改成功，请使用新密码登录');
    clearAuthCookie(res);
    req.session.destroy(() => {
      res.redirect('/login');
    });
  } catch (error) {
    setFlash(req, 'error', `修改密码失败：${error.message}`);
    return res.redirect('/change-password');
  }
});

app.get('/portal', ensureAuth, (req, res) => {
  if (isAdminUser(req.currentUser)) {
    return res.redirect('/admin/dashboard');
  }

  if (!req.currentUser.direction) {
    return res.redirect('/select-direction');
  }

  if (req.currentUser.direction === TRACKS.KNOWLEDGE) {
    return res.redirect('/knowledge');
  }

  return res.redirect('/innovation');
});

app.get('/admin/dashboard', ensureAuth, ensureAdmin, async (req, res, next) => {
  try {
    const stats = await adminDashboardService.getDashboardStats();
    return res.render('admin-dashboard', {
      pageTitle: '后台统计看板',
      stats,
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/admin/export-batches', ensureAuth, ensureAdmin, async (req, res, next) => {
  try {
    await exportBatchService.syncFrozenBatches();

    const exportData = await exportBatchService.getPageData();
    return res.render('admin-export-batches', {
      pageTitle: '资料导出',
      exportData,
      formatBytes,
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/admin/export-batches/config', ensureAuth, ensureAdmin, async (req, res) => {
  try {
    const batchSize = Number.parseInt(req.body.batchSize, 10);
    if (!Number.isFinite(batchSize) || batchSize <= 0) {
      setFlash(req, 'error', '请输入有效的每个 Batch 资料数');
      return res.redirect('/admin/export-batches');
    }

    await exportBatchService.rebuildFrozenBatches({
      batchSize,
      createdBy: req.currentUser.id,
    });

    setFlash(req, 'success', `已按每批 ${batchSize} 份资料重新刷新 Batch 列表`);
    return res.redirect('/admin/export-batches');
  } catch (error) {
    setFlash(req, 'error', `刷新 Batch 规则失败：${error.message}`);
    return res.redirect('/admin/export-batches');
  }
});

app.post('/admin/export-batches/:batchId/downloaded', ensureAuth, ensureAdmin, async (req, res) => {
  const wantsJson = req.get('X-Requested-With') === 'XMLHttpRequest';
  try {
    const batch = await exportBatchService.getBatchById(req.params.batchId);
    if (!batch) {
      if (wantsJson) {
        return res.status(404).json({ message: 'Batch 不存在' });
      }
      setFlash(req, 'error', 'Batch 不存在');
      return res.redirect('/admin/export-batches');
    }
    if (!batch.archive_path) {
      if (wantsJson) {
        return res.status(409).json({ message: '当前 Batch 尚未完成打包，不能标记已下载' });
      }
      setFlash(req, 'error', '当前 Batch 尚未完成打包，不能标记已下载');
      return res.redirect('/admin/export-batches');
    }
    await exportBatchService.markDownloaded(batch.id);
    if (wantsJson) {
      return res.status(204).end();
    }
    setFlash(req, 'success', `已标记 Batch ${String(batch.batch_no).padStart(3, '0')} 为已下载`);
    return res.redirect('/admin/export-batches');
  } catch (error) {
    if (wantsJson) {
      return res.status(500).json({ message: `标记下载失败：${error.message}` });
    }
    setFlash(req, 'error', `标记下载失败：${error.message}`);
    return res.redirect('/admin/export-batches');
  }
});

app.get('/admin/export-batches/tail/download', ensureAuth, ensureAdmin, async (req, res, next) => {
  try {
    const result = await runTailExport();
    return res.download(result.archivePath, path.basename(result.archivePath));
  } catch (error) {
    if (error.message === '当前没有动态尾批资料') {
      return res.status(409).send(error.message);
    }
    return next(error);
  }
});

app.get('/admin/export-batches/tail/manifest', ensureAuth, ensureAdmin, async (req, res, next) => {
  try {
    const result = await runTailExport();
    return res.download(result.manifestPath, path.basename(result.manifestPath));
  } catch (error) {
    if (error.message === '当前没有动态尾批资料') {
      return res.status(409).send(error.message);
    }
    return next(error);
  }
});

app.get('/admin/export-batches/:batchId/download', ensureAuth, ensureAdmin, async (req, res, next) => {
  try {
    let batch = await exportBatchService.getBatchById(req.params.batchId);
    if (!batch) {
      return res.status(404).send('Batch 不存在');
    }

    const archiveReady = batch.archive_path && await storageService.fileExists(batch.archive_path);
    if (!archiveReady) {
      await runExportBatch(batch.id);
      batch = await exportBatchService.getBatchById(batch.id);
    }

    if (!batch?.archive_path) {
      return res.status(409).send('当前 Batch 打包失败，请稍后重试');
    }

    if (batch.status !== exportBatchService.EXPORT_BATCH_STATUS.DOWNLOADED) {
      await exportBatchService.markDownloaded(batch.id);
    }

    return res.download(batch.archive_path, path.basename(batch.archive_path));
  } catch (error) {
    return next(error);
  }
});

app.get('/admin/export-batches/:batchId/manifest', ensureAuth, ensureAdmin, async (req, res, next) => {
  try {
    let batch = await exportBatchService.getBatchById(req.params.batchId);
    if (!batch) {
      return res.status(404).send('Batch 不存在');
    }

    const manifestReady = batch.manifest_path && await storageService.fileExists(batch.manifest_path);
    if (!manifestReady) {
      await runExportBatch(batch.id);
      batch = await exportBatchService.getBatchById(batch.id);
    }

    if (!batch?.manifest_path) {
      return res.status(409).send('当前 Batch 清单生成失败，请稍后重试');
    }

    return res.download(batch.manifest_path, path.basename(batch.manifest_path));
  } catch (error) {
    return next(error);
  }
});

app.get('/select-direction', ensureAuth, async (req, res, next) => {
  if (isAdminUser(req.currentUser)) {
    setFlash(req, 'error', '管理员账号不参与报名流程，请使用 test 账号进行流程测试');
    return res.redirect('/admin/dashboard');
  }

  try {
    const allowed = await canChangeDirection(req.currentUser);
    if (!allowed) {
      setFlash(req, 'error', '该作品已最终提交，不能再修改赛道');
      return res.redirect('/portal');
    }

    delete req.session.pendingDirection;

    return res.render('select-direction', {
      pageTitle: '选择比赛方向',
      tracks: [TRACKS.KNOWLEDGE, TRACKS.INNOVATION],
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/select-direction', ensureAuth, async (req, res) => {
  const direction = req.body.direction;
  const adminMode = isAdminUser(req.currentUser);

  if (![TRACKS.KNOWLEDGE, TRACKS.INNOVATION].includes(direction)) {
    setFlash(req, 'error', '请选择有效的比赛方向');
    return res.redirect('/select-direction');
  }

  if (adminMode) {
    setFlash(req, 'error', '管理员账号不参与报名流程，请使用 test 账号进行流程测试');
    return res.redirect('/admin/dashboard');
  }

  try {
    const allowed = await canChangeDirection(req.currentUser);
    if (!allowed) {
      setFlash(req, 'error', '该作品已最终提交，不能再修改赛道');
      return res.redirect('/portal');
    }

    if (direction === TRACKS.KNOWLEDGE) {
      req.session.pendingDirection = TRACKS.KNOWLEDGE;
      await saveSession(req);
      return res.redirect('/knowledge/confirm');
    }

    await userService.setTrack(req.currentUser.id, direction);
    const submission = await submissionService.getOrCreateByUserId(req.currentUser.id);
    const nextUser = writeSessionUser(req, {
      ...req.currentUser,
      direction,
    });
    writeAuthCookie(res, nextUser);
    syncSubmissionSnapshot(req, submission);

    setFlash(
      req,
      'success',
      `已选择赛道：${TRACK_LABELS[direction]}（可在选择页重新调整）`,
    );
    await saveSession(req);
    return res.redirect('/innovation');
  } catch (error) {
    setFlash(req, 'error', `选择失败：${error.message}`);
    await saveSession(req);
    return res.redirect('/select-direction');
  }
});

app.get('/knowledge/confirm', ensureAuth, async (req, res, next) => {
  if (isAdminUser(req.currentUser)) {
    setFlash(req, 'error', '管理员账号不参与报名流程，请使用 test 账号进行流程测试');
    return res.redirect('/admin/dashboard');
  }

  try {
    const allowed = await canChangeDirection(req.currentUser);
    if (!allowed) {
      setFlash(req, 'error', '该作品已最终提交，不能再修改赛道');
      return res.redirect('/portal');
    }

    if (req.session.pendingDirection !== TRACKS.KNOWLEDGE) {
      return res.redirect('/select-direction');
    }

    return res.render('knowledge-confirm', {
      pageTitle: '知识类确认',
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/knowledge/confirm', ensureAuth, async (req, res) => {
  const adminMode = isAdminUser(req.currentUser);

  if (adminMode) {
    setFlash(req, 'error', '管理员账号不参与报名流程，请使用 test 账号进行流程测试');
    return res.redirect('/admin/dashboard');
  }

  if (req.session.pendingDirection !== TRACKS.KNOWLEDGE) {
    setFlash(req, 'error', '请先完成比赛方向选择');
    return res.redirect('/select-direction');
  }

  try {
    const allowed = await canChangeDirection(req.currentUser);
    if (!allowed) {
      setFlash(req, 'error', '该作品已最终提交，不能再修改赛道');
      return res.redirect('/portal');
    }

    await userService.setTrack(req.currentUser.id, TRACKS.KNOWLEDGE);
    const nextUser = writeSessionUser(req, {
      ...req.currentUser,
      direction: TRACKS.KNOWLEDGE,
    });
    writeAuthCookie(res, nextUser);
    clearSessionSubmission(req);
    delete req.session.pendingDirection;

    setFlash(
      req,
      'success',
      `已最终提交：${TRACK_LABELS[TRACKS.KNOWLEDGE]}`,
    );
    await saveSession(req);
    return res.redirect('/knowledge/success');
  } catch (error) {
    setFlash(req, 'error', `确认失败：${error.message}`);
    await saveSession(req);
    return res.redirect('/knowledge/confirm');
  }
});

app.get('/knowledge/success', ensureAuth, (req, res, next) => ensureTrack(req, res, next, TRACKS.KNOWLEDGE), (req, res) => {
  res.render('knowledge-success', {
    pageTitle: '提交成功',
  });
});

app.get('/knowledge', ensureAuth, (req, res, next) => ensureTrack(req, res, next, TRACKS.KNOWLEDGE), (req, res) => {
  res.render('knowledge', {
    pageTitle: '知识类赛道',
  });
});

app.get('/innovation', ensureAuth, (req, res, next) => ensureTrack(req, res, next, TRACKS.INNOVATION), async (req, res, next) => {
  try {
    const submission = await submissionService.getOrCreateByUserId(req.currentUser.id);
    syncSubmissionSnapshot(req, submission);

    const fileRows = ALL_RULES.map((rule) => {
      const prefix = rule.key;
      return {
        key: prefix,
        inputName: rule.inputName,
        label: rule.label,
        ext: rule.ext,
        maxMb: rule.maxMb,
        required: rule.required,
        hasFile: Boolean(submission[`${prefix}_file_path`]),
        originalName: resolveDisplayFileName(submission, prefix),
        storedName: submission[`${prefix}_stored_name`],
        uploadedAt: submission[`${prefix}_uploaded_at`],
      };
    });

    return res.render('innovation', {
      pageTitle: '创新设计类作品提交',
      submission,
      fileRows,
      statusMap: SUBMISSION_STATUS,
      storageDriver: storageService.isOssDriver() ? 'oss' : 'local',
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/uploads/sign', ensureAuth, async (req, res) => {
  if (!storageService.isOssDriver()) {
    return res.status(400).json({ message: '当前环境未启用 OSS 直传' });
  }

  if (isAdminUser(req.currentUser)) {
    return res.status(403).json({ message: '管理员账号不参与报名流程' });
  }

  if (!req.currentUser || req.currentUser.direction !== TRACKS.INNOVATION) {
    return res.status(403).json({ message: '当前账号未进入创新设计类赛道' });
  }

  const { fieldKey, fileName, contentType, size } = req.body || {};
  const rule = FILE_RULES[fieldKey];
  if (!rule) {
    return res.status(400).json({ message: '文件类型不存在' });
  }

  if (extOf(fileName) !== rule.ext) {
    return res.status(400).json({ message: `${rule.label}仅支持${rule.ext.toUpperCase()}文件` });
  }

  if (Number(size) > toBytes(rule.maxMb)) {
    return res.status(400).json({ message: `${rule.label}大小不能超过${rule.maxMb}MB` });
  }

  try {
    const cachedSubmission = readSessionSubmission(req);
    const submission = cachedSubmission?.exists
      ? cachedSubmission
      : syncSubmissionSnapshot(req, await submissionService.getOrCreateByUserId(req.currentUser.id));
    if (submission.status === SUBMISSION_STATUS.SUBMITTED) {
      return res.status(409).json({ message: '该作品已最终提交，不能再修改' });
    }

    const storedName = buildStoredName(req.currentUser.registration_no, rule.key, rule.ext);
    const result = await storageService.signDirectUpload({
      registrationNo: req.currentUser.registration_no,
      fieldKey: rule.key,
      storedName,
      contentType,
    });

    return res.json({
      fieldKey: rule.key,
      objectKey: result.objectKey,
      uploadUrl: result.uploadUrl,
      headers: result.headers,
      expiresIn: result.expiresIn,
      storedName,
      originalName: normalizeOriginalName(fileName),
      contentType,
      size: Number(size) || 0,
    });
  } catch (error) {
    return res.status(500).json({ message: `签名失败：${error.message}` });
  }
});

app.post('/innovation', ensureAuth, innovationUploadMiddleware, async (req, res) => {
  const adminMode = isAdminUser(req.currentUser);

  if (adminMode) {
    setFlash(req, 'error', '管理员账号不参与报名流程，请使用 test 账号进行流程测试');
    return res.redirect('/admin/dashboard');
  }

  if (!req.currentUser || req.currentUser.direction !== TRACKS.INNOVATION) {
    setFlash(req, 'error', '当前账号未进入创新设计类赛道');
    return res.redirect('/portal');
  }

  const action = req.body.action === 'submit' ? 'submit' : 'save';

  try {
    const submission = await submissionService.getOrCreateByUserId(req.currentUser.id);

    if (submission.status === SUBMISSION_STATUS.SUBMITTED) {
      setFlash(req, 'error', '该作品已最终提交，不能再修改');
      return res.redirect('/innovation');
    }

    const workTitle = sanitizeWorkTitle(req.body.workTitle || submission.work_title || '');
    const updates = {};
    const incomingFiles = req.files || {};
    const uploadedFilesPayload = parseUploadedFilesPayload(req.body.uploadedFilesPayload);

    if (workTitle) {
      updates.work_title = workTitle;
    }

    const validationErrors = [];
    if (storageService.isOssDriver()) {
      const validationResults = await Promise.all(
        Object.entries(uploadedFilesPayload).map(async ([fieldKey, payload]) => {
          const rule = FILE_RULES[fieldKey];
          if (!rule || !payload || typeof payload !== 'object') {
            return { error: '上传元数据不合法，请重新上传文件' };
          }

          if (!storageService.isExpectedObjectKey(req.currentUser.registration_no, rule.key, payload.objectKey)) {
            return { error: `${rule.label}对象路径不合法，请重新上传` };
          }

          if (extOf(payload.originalName) !== rule.ext) {
            return { error: `${rule.label}仅支持${rule.ext.toUpperCase()}文件` };
          }

          if (Number(payload.size) > toBytes(rule.maxMb)) {
            return { error: `${rule.label}大小不能超过${rule.maxMb}MB` };
          }

          const exists = await storageService.hasStoredObject(payload.objectKey);
          if (!exists) {
            return { error: `${rule.label}尚未上传成功，请重新上传` };
          }

          const oldReference = submission[`${rule.key}_file_path`];
          return {
            oldReference: oldReference && oldReference !== payload.objectKey ? oldReference : null,
            columns: buildFileColumns(
              rule.key,
              payload.objectKey,
              normalizeOriginalName(payload.originalName),
              payload.storedName || path.basename(payload.objectKey),
              Number(payload.size) || 0,
            ),
          };
        }),
      );

      const oldReferencesToDelete = validationResults
        .map((result) => result.oldReference)
        .filter(Boolean);

      for (const result of validationResults) {
        if (result.error) {
          validationErrors.push(result.error);
          continue;
        }

        Object.assign(updates, result.columns);
      }

      if (validationErrors.length > 0) {
        setFlash(req, 'error', validationErrors.join('；'));
        return res.redirect('/innovation');
      }

      if (Object.keys(updates).length > 0) {
        await submissionService.updateByUserId(req.currentUser.id, updates);
        await Promise.all(oldReferencesToDelete.map((reference) => storageService.removeStoredObject(reference)));
      }
    } else {
      for (const rule of ALL_RULES) {
        const file = incomingFiles[rule.inputName]?.[0];
        if (!file) continue;

        const message = validateUploadedFile(file, rule);
        if (message) {
          validationErrors.push(message);
        }
      }

      if (validationErrors.length > 0) {
        setFlash(req, 'error', validationErrors.join('；'));
        return res.redirect('/innovation');
      }

      const userDir = path.join(config.upload.rootDir, req.currentUser.registration_no);
      await ensureDir(userDir);

      const newFileMetaMap = {};
      const newFilesForRollback = [];

      try {
        for (const rule of ALL_RULES) {
          const file = incomingFiles[rule.inputName]?.[0];
          if (!file) continue;

          const physicalName = buildPhysicalName(req.currentUser.registration_no, rule.key, rule.ext);
          const absolutePath = path.join(userDir, physicalName);
          await storageService.putLocalFile({
            absolutePath,
            buffer: file.buffer,
          });

          newFilesForRollback.push(absolutePath);

          newFileMetaMap[rule.key] = {
            newPath: absolutePath,
            originalName: normalizeOriginalName(file.originalname),
            storedName: buildStoredName(req.currentUser.registration_no, rule.key, rule.ext),
            fileSize: file.size,
            oldPath: submission[`${rule.key}_file_path`],
          };
        }
      } catch (error) {
        for (const filePath of newFilesForRollback) {
          // eslint-disable-next-line no-await-in-loop
          await storageService.removeStoredObject(filePath);
        }
        throw error;
      }

      for (const rule of ALL_RULES) {
        const meta = newFileMetaMap[rule.key];
        if (!meta) continue;

        await storageService.removeStoredObject(meta.oldPath);
        Object.assign(
          updates,
          buildFileColumns(rule.key, meta.newPath, meta.originalName, meta.storedName, meta.fileSize),
        );
      }

      if (Object.keys(updates).length > 0) {
        await submissionService.updateByUserId(req.currentUser.id, updates);
      }
    }

    const latestSubmission = {
      ...submission,
      ...updates,
    };
    syncSubmissionSnapshot(req, latestSubmission);

    if (action === 'submit') {
      if (!latestSubmission.work_title) {
        setFlash(req, 'error', '最终提交前请先填写作品题目');
        return res.redirect('/innovation');
      }

      if (!hasAllRequiredFiles(latestSubmission)) {
        const missing = missingRequiredLabels(latestSubmission);
        setFlash(req, 'error', `请先完成必填材料上传：${missing.join('、')}`);
        return res.redirect('/innovation');
      }

      await submissionService.markSubmitted(req.currentUser.id);
      syncSubmissionSnapshot(req, {
        ...latestSubmission,
        status: SUBMISSION_STATUS.SUBMITTED,
      });
      await exportBatchService.syncFrozenBatches();
      setFlash(
        req,
        'success',
        '材料已最终提交，系统已锁定，不可再修改',
      );
      return res.redirect('/innovation');
    }

    setFlash(req, 'success', '草稿已保存');
    return res.redirect('/innovation');
  } catch (error) {
    setFlash(req, 'error', `保存失败：${error.message}`);
    return res.redirect('/innovation');
  }
});

app.get('/innovation/file/:fieldKey', ensureAuth, async (req, res, next) => {
  if (isAdminUser(req.currentUser)) {
    return res.redirect('/admin/dashboard');
  }

  if (!req.currentUser || req.currentUser.direction !== TRACKS.INNOVATION) {
    return res.redirect('/portal');
  }

  const { fieldKey } = req.params;
  const rule = FILE_RULES[fieldKey];
  if (!rule) {
    return res.status(404).send('文件类型不存在');
  }

  try {
    const submission = await submissionService.getOrCreateByUserId(req.currentUser.id);
    const pathKey = `${rule.key}_file_path`;
    if (!submission[pathKey]) {
      return res.status(404).send('该文件尚未上传');
    }

    setFlash(req, 'error', '已上传文件不提供下载，请删除后重新上传');
    return res.redirect('/innovation');
  } catch (error) {
    return next(error);
  }
});

app.post('/innovation/file/:fieldKey/delete', ensureAuth, async (req, res) => {
  if (isAdminUser(req.currentUser)) {
    return res.redirect('/admin/dashboard');
  }

  if (!req.currentUser || req.currentUser.direction !== TRACKS.INNOVATION) {
    return res.redirect('/portal');
  }

  const { fieldKey } = req.params;
  const rule = FILE_RULES[fieldKey];
  if (!rule) {
    setFlash(req, 'error', '文件类型不存在');
    return res.redirect('/innovation');
  }

  try {
    const submission = await submissionService.getOrCreateByUserId(req.currentUser.id);
    if (submission.status === SUBMISSION_STATUS.SUBMITTED) {
      setFlash(req, 'error', '该作品已最终提交，不能再修改');
      return res.redirect('/innovation');
    }

    const pathKey = `${rule.key}_file_path`;
    if (!submission[pathKey]) {
      setFlash(req, 'error', '该文件尚未上传，无需删除');
      return res.redirect('/innovation');
    }

    await storageService.removeStoredObject(submission[pathKey]);
    await submissionService.updateByUserId(req.currentUser.id, {
      [`${rule.key}_file_path`]: null,
      [`${rule.key}_original_name`]: null,
      [`${rule.key}_stored_name`]: null,
      [`${rule.key}_file_size`]: null,
      [`${rule.key}_uploaded_at`]: null,
    });
    syncSubmissionSnapshot(req, submission);

    setFlash(req, 'success', `已删除${rule.label}，请重新上传`);
    return res.redirect('/innovation');
  } catch (error) {
    setFlash(req, 'error', `删除失败：${error.message}`);
    return res.redirect('/innovation');
  }
});

app.get('/downloads/integrity-template', async (req, res, next) => {
  try {
    await fs.access(INTEGRITY_TEMPLATE_PATH);
    return res.download(INTEGRITY_TEMPLATE_PATH, '诚信承诺书模板.pdf');
  } catch (error) {
    return next(error);
  }
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      setFlash(req, 'error', `上传文件过大，单文件最大不超过${MAX_UPLOAD_MB}MB`);
      return res.redirect('/innovation');
    }
  }

  console.error(error);
  if (req.session) {
    setFlash(req, 'error', `系统错误：${error.message}`);
  }

  if (req.originalUrl.startsWith('/innovation')) {
    return res.redirect('/innovation');
  }

  return res.status(500).send('系统错误，请稍后重试');
});

async function startServer() {
  await ensureRedisConnected(redisClient);
  return app.listen(config.app.port, config.app.host, () => {
    console.log(`服务已启动：http://${config.app.host}:${config.app.port}`);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('服务启动失败：', error.message);
    process.exit(1);
  });
}

module.exports = {
  app,
  startServer,
};
