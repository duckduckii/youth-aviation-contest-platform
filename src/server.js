const fs = require('fs/promises');
const path = require('path');
const express = require('express');
const session = require('express-session');
const multer = require('multer');

const config = require('./config');
const { ensureAuth, ensureGuest } = require('./middleware/auth');
const { TRACKS, TRACK_LABELS, SUBMISSION_STATUS } = require('./constants');
const userService = require('./services/user-service');
const submissionService = require('./services/submission-service');
const {
  sanitizeWorkTitle,
  extOf,
  ensureDir,
  removeFile,
  buildStoredName,
  buildPhysicalName,
} = require('./utils/file-helpers');

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
    required: true,
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

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function consumeFlash(req) {
  const flash = req.session.flash || null;
  delete req.session.flash;
  return flash;
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

function buildFileColumns(prefix, filePath, originalName, storedName) {
  return {
    [`${prefix}_file_path`]: filePath,
    [`${prefix}_original_name`]: originalName,
    [`${prefix}_stored_name`]: storedName,
    [`${prefix}_uploaded_at`]: new Date(),
  };
}

function hasAllRequiredFiles(submission) {
  for (const rule of ALL_RULES) {
    if (!submission[`${rule.key}_file_path`]) {
      return false;
    }
  }
  return true;
}

function missingRequiredLabels(submission) {
  return ALL_RULES.filter((rule) => !submission[`${rule.key}_file_path`]).map((rule) => rule.label);
}

async function ensureTrack(req, res, next, expectedTrack) {
  if (!req.currentUser) return res.redirect('/login');

  if (!req.currentUser.direction) {
    return res.redirect('/select-direction');
  }

  if (req.currentUser.direction !== expectedTrack) {
    return res.redirect('/portal');
  }

  return next();
}

app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: config.app.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 8,
    },
  }),
);

app.use('/public', express.static(path.join(process.cwd(), 'public')));

app.use(async (req, res, next) => {
  res.locals.flash = consumeFlash(req);
  res.locals.currentUser = null;
  res.locals.trackLabels = TRACK_LABELS;

  if (!req.session.userId) {
    return next();
  }

  try {
    const user = await userService.findById(req.session.userId);
    if (!user) {
      req.session.destroy(() => {});
      return res.redirect('/login');
    }

    req.currentUser = user;
    res.locals.currentUser = user;
    return next();
  } catch (error) {
    return next(error);
  }
});

app.get('/', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  return res.redirect('/portal');
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
    return res.redirect('/portal');
  } catch (error) {
    setFlash(req, 'error', `登录失败：${error.message}`);
    return res.redirect('/login');
  }
});

app.post('/logout', ensureAuth, (req, res) => {
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
    const user = await userService.findById(req.session.userId);
    const verified = await userService.verifyLogin(user.registration_no, oldPassword);
    if (!verified) {
      setFlash(req, 'error', '旧密码错误');
      return res.redirect('/change-password');
    }

    await userService.changePassword(req.session.userId, newPassword);
    setFlash(req, 'success', '密码修改成功，请使用新密码登录');
    req.session.destroy(() => {
      res.redirect('/login');
    });
  } catch (error) {
    setFlash(req, 'error', `修改密码失败：${error.message}`);
    return res.redirect('/change-password');
  }
});

app.get('/portal', ensureAuth, (req, res) => {
  if (!req.currentUser.direction) {
    return res.redirect('/select-direction');
  }

  if (req.currentUser.direction === TRACKS.KNOWLEDGE) {
    return res.redirect('/knowledge');
  }

  return res.redirect('/innovation');
});

app.get('/select-direction', ensureAuth, (req, res) => {
  if (req.currentUser.direction) {
    return res.redirect('/portal');
  }

  return res.render('select-direction', {
    pageTitle: '选择比赛方向',
    tracks: [TRACKS.KNOWLEDGE, TRACKS.INNOVATION],
  });
});

app.post('/select-direction', ensureAuth, async (req, res) => {
  const direction = req.body.direction;

  if (![TRACKS.KNOWLEDGE, TRACKS.INNOVATION].includes(direction)) {
    setFlash(req, 'error', '请选择有效的比赛方向');
    return res.redirect('/select-direction');
  }

  if (req.currentUser.direction) {
    setFlash(req, 'error', '比赛方向已经确认，无法修改');
    return res.redirect('/portal');
  }

  try {
    const updated = await userService.setTrackOnce(req.currentUser.id, direction);
    if (!updated) {
      setFlash(req, 'error', '比赛方向已锁定，无法重复选择');
      return res.redirect('/portal');
    }

    setFlash(req, 'success', `已确认赛道：${TRACK_LABELS[direction]}`);
    return res.redirect('/portal');
  } catch (error) {
    setFlash(req, 'error', `选择失败：${error.message}`);
    return res.redirect('/select-direction');
  }
});

app.get('/knowledge', ensureAuth, (req, res, next) => ensureTrack(req, res, next, TRACKS.KNOWLEDGE), (req, res) => {
  res.render('knowledge', {
    pageTitle: '知识类提交流程',
  });
});

app.get('/innovation', ensureAuth, (req, res, next) => ensureTrack(req, res, next, TRACKS.INNOVATION), async (req, res, next) => {
  try {
    const submission = await submissionService.getOrCreateByUserId(req.currentUser.id);

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
        originalName: submission[`${prefix}_original_name`],
        storedName: submission[`${prefix}_stored_name`],
        uploadedAt: submission[`${prefix}_uploaded_at`],
      };
    });

    return res.render('innovation', {
      pageTitle: '创新设计类作品提交',
      submission,
      fileRows,
      statusMap: SUBMISSION_STATUS,
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/innovation', ensureAuth, uploadFields, async (req, res) => {
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

    if (workTitle) {
      updates.work_title = workTitle;
    }

    const validationErrors = [];
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

        const physicalName = buildPhysicalName(rule.key, rule.ext);
        const absolutePath = path.join(userDir, physicalName);
        await fs.writeFile(absolutePath, file.buffer);

        newFilesForRollback.push(absolutePath);

        newFileMetaMap[rule.key] = {
          newPath: absolutePath,
          originalName: file.originalname,
          storedName: buildStoredName(rule.key, workTitle),
          oldPath: submission[`${rule.key}_file_path`],
        };
      }
    } catch (error) {
      for (const filePath of newFilesForRollback) {
        // eslint-disable-next-line no-await-in-loop
        await removeFile(filePath);
      }
      throw error;
    }

    for (const rule of ALL_RULES) {
      const meta = newFileMetaMap[rule.key];
      if (!meta) continue;

      await removeFile(meta.oldPath);
      Object.assign(
        updates,
        buildFileColumns(rule.key, meta.newPath, meta.originalName, meta.storedName),
      );
    }

    if (Object.keys(updates).length > 0) {
      await submissionService.updateByUserId(req.currentUser.id, updates);
    }

    const latestSubmission = {
      ...submission,
      ...updates,
    };

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
      setFlash(req, 'success', '材料已最终提交，系统已锁定，不可再修改');
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
    const nameKey = `${rule.key}_stored_name`;

    if (!submission[pathKey]) {
      return res.status(404).send('该文件尚未上传');
    }

    return res.download(submission[pathKey], submission[nameKey] || undefined);
  } catch (error) {
    return next(error);
  }
});

app.get('/downloads/integrity-template', (req, res) => {
  const content = [
    '全国青少年安全与应急科普创新大赛',
    '创新设计赛（航模方向）诚信承诺书（模板）',
    '',
    '本人承诺：提交的作品为原创，材料真实有效，未侵犯他人合法权益。',
    '',
    '学生签字：______________',
    '指导教师签字：______________',
    '日期：______年____月____日',
  ].join('\n');

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''诚信承诺书模板.txt");
  res.send(content);
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

app.listen(config.app.port, config.app.host, () => {
  console.log(`服务已启动：http://${config.app.host}:${config.app.port}`);
});
