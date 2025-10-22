// middlewares/requireAuth.js
const { auth, db } = require('../firebase');

async function requireAuth(req, res, next) {
  try {
    const hdr = req.headers.authorization || '';
    const m = hdr.match(/^Bearer (.+)$/i);
    if (!m) return res.status(401).json({ error: 'NO_TOKEN' });

    const idToken = m[1];
    const decoded = await auth().verifyIdToken(idToken);

    // Charge le profil Firestore pour connaître le rôle
    const snap = await db().collection('users').doc(decoded.uid).get();
    if (!snap.exists) return res.status(401).json({ error: 'USER_NOT_FOUND' });

    const u = snap.data() || {};
    req.user = {
      uid: decoded.uid,
      email: decoded.email || u.email || null,
      role: u.role || null,
      profile: u,
    };
    next();
  } catch (e) {
    console.error('[requireAuth]', e.message);
    res.status(401).json({ error: 'INVALID_TOKEN' });
  }
}

module.exports = { requireAuth };
