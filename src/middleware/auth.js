function ensureAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  return next();
}

function ensureGuest(req, res, next) {
  if (req.session.userId) {
    return res.redirect('/portal');
  }
  return next();
}

module.exports = {
  ensureAuth,
  ensureGuest,
};
