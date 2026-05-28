const jwt = require('jsonwebtoken');

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set in .env. Server cannot start securely.');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

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
