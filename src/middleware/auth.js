function wantsJson(req) {
  if (req.originalUrl.startsWith('/api/')) {
    return true;
  }

  const accepted = req.accepts(['html', 'json']);
  return req.xhr || accepted === 'json';
}

function isAuthenticated(req) {
  return Boolean(req.currentUser?.id || req.session?.userId || req.authCookieUser?.id);
}

function ensureAuth(req, res, next) {
  if (!isAuthenticated(req)) {
    if (wantsJson(req)) {
      return res.status(401).json({ message: '未登录或登录状态已失效' });
    }
    return res.redirect('/login');
  }
  return next();
}

function ensureGuest(req, res, next) {
  if (isAuthenticated(req)) {
    return res.redirect('/portal');
  }
  return next();
}

module.exports = {
  ensureAuth,
  ensureGuest,
};
