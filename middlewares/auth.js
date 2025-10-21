// middlewares/auth.js
const { auth } = require('../firebase');

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing Authorization Bearer token' });

    const decoded = await auth().verifyIdToken(token);
    req.user = {
      uid: decoded.uid,
      role: decoded.role,                   // claim personnalisé
      studentId: decoded.studentId,         // si besoin plus tard
      parentOf: decoded.parentOf || []
    };
    req._decoded = decoded;                 // email, name, etc.
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { requireAuth };
