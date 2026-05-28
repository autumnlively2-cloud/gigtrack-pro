const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

module.exports = function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    req.userId = payload.id;
    req.userPlan = payload.plan;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Plan guard factory
module.exports.requirePlan = function requirePlan(minPlan) {
  const rank = { free: 0, pro: 1, business: 2 };
  return (req, res, next) => {
    if ((rank[req.userPlan] || 0) < rank[minPlan]) {
      return res.status(403).json({ error: 'upgrade_required', minPlan });
    }
    next();
  };
};
