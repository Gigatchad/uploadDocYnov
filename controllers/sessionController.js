// controllers/sessionController.js
const { auth, db } = require('../firebase');
const { FieldValue } = require('firebase-admin/firestore');
const { auditLog } = require('../services/audit');

/**
 * GET /api/me
 * Retourne l'utilisateur connecté (Firestore) + infos utiles pour le front.
 * -> le front choisira la route selon "role": etudiant | parent | personnel | admin
 */
async function getMe(req, res) {
  const uid = req.user.uid; // fourni par requireAuth
  const firestore = db();

  const snap = await firestore.collection('users').doc(uid).get();
  if (!snap.exists) return res.status(404).json({ error: 'USER_NOT_FOUND' });

  const user = snap.data() || {};
  // source de vérité pour le rôle = Firestore
  const role = user.role || null;

  // (optionnel) récupérer les claims pour debug/concordance
  let claims = {};
  try {
    const u = await auth().getUser(uid);
    claims = (u.customClaims || {});
  } catch (_) {}

  // petit log d’accès (non bloquant)
  auditLog(req, 'SESSION_ME', { collection: 'users', id: uid }, { role }).catch(() => {});

  return res.json({
    id: snap.id,
    role,                                 // ← le front va router selon ceci
    email: user.email || null,
    notifyEmail: user.notifyEmail || null,
    prenom: user.prenom || null,
    nom: user.nom || null,
    displayName: user.displayName || null,
    filiere: user.filiere || null,
    niveau: user.niveau || null,
    parentUid: user.parentUid || null,
    parentOf: Array.isArray(user.parentOf) ? user.parentOf : [],
    photoURL: user.photoURL || null,
    claims,                               // informatif
    fcmTokens: Array.isArray(user.fcmTokens) ? user.fcmTokens : [],
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null
  });
}

/**
 * POST /api/fcm/register
 * body: { token }
 * Enregistre le FCM token (ajout si absent) sur users/{uid}.fcmTokens
 */
async function registerFcmToken(req, res) {
  const uid = req.user.uid;
  const { token } = req.body || {};
  if (!token || typeof token !== 'string' || token.length < 10) {
    return res.status(400).json({ error: 'INVALID_FCM_TOKEN' });
  }

  const firestore = db();
  const ref = firestore.collection('users').doc(uid);

  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('USER_NOT_FOUND');

    const cur = Array.isArray(snap.data().fcmTokens) ? snap.data().fcmTokens : [];
    if (!cur.includes(token)) {
      tx.update(ref, {
        fcmTokens: [...cur, token],
        updatedAt: FieldValue.serverTimestamp()
      });
    }
  });

  await auditLog(req, 'FCM_REGISTER', { collection: 'users', id: uid }, { token: token.slice(0, 12) + '…' });
  return res.json({ ok: true });
}

/**
 * POST /api/fcm/unregister
 * body: { token }
 * Retire le FCM token (utiliser lors d’un logout si tu veux le retirer du profil)
 */
async function unregisterFcmToken(req, res) {
  const uid = req.user.uid;
  const { token } = req.body || {};
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'INVALID_FCM_TOKEN' });
  }

  const firestore = db();
  const ref = firestore.collection('users').doc(uid);

  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return; // rien à faire

    const cur = Array.isArray(snap.data().fcmTokens) ? snap.data().fcmTokens : [];
    const next = cur.filter(t => t !== token);
    tx.update(ref, {
      fcmTokens: next,
      updatedAt: FieldValue.serverTimestamp()
    });
  });

  await auditLog(req, 'FCM_UNREGISTER', { collection: 'users', id: uid }, { token: token.slice(0, 12) + '…' });
  return res.json({ ok: true });
}

/**
 * POST /api/session/log-signin
 * (optionnel) Le front peut appeler ça juste après signIn pour tracer l’évènement.
 * body: { provider?: 'password'|'google'|..., deviceInfo?: string }
 */
async function logSignIn(req, res) {
  const uid = req.user.uid;
  const { provider = 'password', deviceInfo = null } = req.body || {};

  await auditLog(
    req,
    'SIGN_IN',
    { collection: 'users', id: uid },
    { provider, deviceInfo }
  );

  return res.json({ ok: true });
}

module.exports = {
  getMe,
  registerFcmToken,
  unregisterFcmToken,
  logSignIn,
};
