// controllers/authController.js
const { db } = require('../firebase');
const { auditLog } = require('../services/audit');
const { FieldValue } = require('firebase-admin/firestore');

/**
 * GET /api/me
 * - upsert users/{uid} minimal
 * - dernière connexion
 * - journalise LOGIN (action)
 */
async function me(req, res) {
  const firestore = db();
  const uid = req.user.uid;

  const usersRef = firestore.collection('users').doc(uid);
  const snap = await usersRef.get();

  const base = {
    email: req._decoded.email || null,
    role: req.user.role || null,
    displayName: req._decoded.name || null,
    displayNameLower: (req._decoded.name || '').toLowerCase() || null,
    updatedAt: FieldValue.serverTimestamp(),
    lastLoginAt: FieldValue.serverTimestamp()
  };

  if (!snap.exists) {
    await usersRef.set({
      ...base,
      createdAt: FieldValue.serverTimestamp(),
      fcmTokens: []
    }, { merge: true });
  } else {
    await usersRef.set(base, { merge: true });
  }

  // Log d'action (on garde)
  await auditLog(req, 'LOGIN', { collection: 'users', id: uid });

  return res.json({
    uid,
    role: req.user.role || null,
    email: base.email,
    displayName: base.displayName
  });
}

/**
 * POST /api/me/fcm
 * body: { token: string }
 * - Stocke le token FCM dans users/{uid}.fcmTokens
 * - AUCUN log (pas une action métier)
 */
async function registerFcmToken(req, res) {
  const token = (req.body?.token || '').trim();
  if (!token) return res.status(400).json({ error: 'FCM token required' });

  const firestore = db();
  const uid = req.user.uid;

  await firestore.collection('users').doc(uid).set({
    fcmTokens: FieldValue.arrayUnion(token),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  // Pas de auditLog ici (tu ne veux pas tracer ça)
  return res.status(204).end();
}

module.exports = { me, registerFcmToken };
