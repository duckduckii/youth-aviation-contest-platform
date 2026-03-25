function buildSessionSubmission(submission) {
  if (!submission) return null;

  return {
    exists: true,
    status: submission.status || 'DRAFT',
  };
}

function readSessionSubmission(req) {
  return req?.session?.authSubmission || null;
}

function writeSessionSubmission(req, submission) {
  if (!req?.session) return null;
  const snapshot = buildSessionSubmission(submission);
  req.session.authSubmission = snapshot;
  return snapshot;
}

function clearSessionSubmission(req) {
  if (!req?.session) return;
  delete req.session.authSubmission;
}

module.exports = {
  buildSessionSubmission,
  readSessionSubmission,
  writeSessionSubmission,
  clearSessionSubmission,
};
