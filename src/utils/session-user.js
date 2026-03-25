function buildSessionUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    registration_no: user.registration_no,
    direction: user.direction || null,
  };
}

function readSessionUser(req) {
  return req?.session?.authUser || null;
}

function writeSessionUser(req, user) {
  if (!req?.session) return null;
  const snapshot = buildSessionUser(user);
  req.session.authUser = snapshot;
  return snapshot;
}

function clearSessionUser(req) {
  if (!req?.session) return;
  delete req.session.authUser;
}

module.exports = {
  buildSessionUser,
  readSessionUser,
  writeSessionUser,
  clearSessionUser,
};
