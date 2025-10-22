// controllers/authInviteController.js
const { auth, db } = require('../firebase');
const { FieldValue } = require('firebase-admin/firestore');
const { consumeInviteToken } = require('../services/invite');

/**
 * POST /api/auth/initial-password
 * body: { token, email, password }
 */
async function setInitialPassword(req, res) {
  try {
    const { token, email, password } = req.body || {};
    if (!token || !email || !password) {
      return res.status(400).json({ error: 'MISSING_FIELDS' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'WEAK_PASSWORD' });
    }

    // 1) valider/consommer le token
    let used;
    try {
      used = await consumeInviteToken(token, email);
    } catch (e) {
      const code = e.message;
      const map = {
        TOKEN_NOT_FOUND: 404,
        TOKEN_ALREADY_USED: 409,
        TOKEN_EXPIRED: 410,
        EMAIL_MISMATCH: 400
      };
      return res.status(map[code] || 400).json({ error: code });
    }

    // 2) poser le mot de passe (Auth)
    await auth().updateUser(used.uid, { password });

    // 3) tracer côté Firestore
    await db().collection('users').doc(used.uid).set({
      passwordSetAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    return res.json({ ok: true });
  } catch (e) {
    console.error('setInitialPassword failed', e);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
}

module.exports = { setInitialPassword };
