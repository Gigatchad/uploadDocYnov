// controllers/passwordController.js
const crypto = require('crypto');
const { auth, db } = require('../firebase');
const { FieldValue } = require('firebase-admin/firestore');
const { auditLog } = require('../services/audit');
const { sendResetCodeEmail } = require('../services/email');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// ====== OTP config ======
const COLLECTION   = 'password_resets';
const CODE_TTL_MIN = 10; // minutes
const MAX_ATTEMPTS = 5;

function hashCode(code, salt) {
  return crypto.createHash('sha256').update(`${code}:${salt}`).digest('hex');
}
function random6() {
  return (Math.floor(100000 + Math.random() * 900000)).toString();
}

/* =========================
   ADMIN (EXISTANTS)
========================= */

/**
 * POST /api/password/send-link
 * body: { email, continueUrl? }
 * -> génère un lien de reset officiel Firebase (usage admin)
 */
async function sendPasswordSetupLink(req, res) {
  try {
    const { email, continueUrl } = req.body || {};
    if (!email) return res.status(400).json({ error: 'EMAIL_REQUIRED' });

    const actionCodeSettings = {
      url: continueUrl || `${FRONTEND_URL}/new-user`,
      handleCodeInApp: false,
    };

    const link = await auth().generatePasswordResetLink(email, actionCodeSettings);
    auditLog(req, 'PASSWORD_SEND_LINK', { collection: 'users_by_email', id: email }, {}).catch(() => {});
    return res.json({ ok: true, link });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'SERVER_ERROR', details: e.message });
  }
}

/**
 * POST /api/password/mark-set
 * headers: Authorization: Bearer <idToken>
 * body: { uid? }
 * -> marque le user comme "password défini" dans Firestore
 */
async function markPasswordSet(req, res) {
  try {
    const firestore = db();
    const uid = req.body?.uid || req.user?.uid;
    if (!uid) return res.status(400).json({ error: 'UID_REQUIRED' });

    const ref = firestore.collection('users').doc(uid);
    await ref.set(
      { passwordSetAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    auditLog(req, 'PASSWORD_MARK_SET', { collection: 'users', id: uid }, {}).catch(() => {});
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'SERVER_ERROR', details: e.message });
  }
}

/* =========================
   FORGOT / VERIFY / RESET
========================= */

/**
 * POST /api/password/forgot
 * body: { email }
 * Règles:
 *  - Si email inexistant dans Firestore => 404 EMAIL_NOT_FOUND (pas d’envoi)
 *  - Si role === 'admin'            => 404 EMAIL_NOT_FOUND (pas d’envoi)
 *  - Sinon: génère code, envoie email, stocke hash
 */
async function requestResetCode(req, res) {
  try {
    const rawEmail = req.body?.email || '';
    const email = String(rawEmail).trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'EMAIL_REQUIRED' });
    }

    const firestore = db();

    // 🔎 On cherche l'utilisateur en base (Firestore = source de vérité pour le rôle)
    let uid = null;
    let role = null;
    try {
      // Trouver user Firebase (si présent)
      const u = await auth().getUserByEmail(email);
      uid = u.uid;
    } catch (_) {
      // on continue, mais on check Firestore par e-mail
    }

    // 1) Essayer Firestore par uid si on l'a
    let userSnap = null;
    if (uid) {
      userSnap = await firestore.collection('users').doc(uid).get();
    }

    // 2) Si pas de doc via uid, fallback: rechercher par email (index conseillé)
    if (!userSnap || !userSnap.exists) {
      const qs = await firestore.collection('users').where('email', '==', email).limit(1).get();
      if (!qs.empty) {
        userSnap = qs.docs[0];
        uid = userSnap.id;
      }
    }

    if (!userSnap || !userSnap.exists) {
      // Email inconnu => même message
      auditLog(req, 'PASSWORD_FORGOT_BLOCK', { collection: 'users_by_email', id: email }, { reason: 'EMAIL_NOT_FOUND' }).catch(() => {});
      return res.status(404).json({ error: 'EMAIL_NOT_FOUND' });
    }

    const userData = userSnap.data() || {};
    role = userData.role || null;

    // ⛔️ Interdit pour admin => même message
    if (role === 'admin') {
      auditLog(req, 'PASSWORD_FORGOT_BLOCK', { collection: 'users_by_email', id: email }, { reason: 'ADMIN_FORBIDDEN' }).catch(() => {});
      return res.status(404).json({ error: 'EMAIL_NOT_FOUND' });
    }

    const salt = process.env.CODE_SALT || 'change-me';
    const expiresAt = Date.now() + CODE_TTL_MIN * 60 * 1000;

    // Génère + stocke (hashé)
    const code = random6();
    const codeHash = hashCode(code, salt);
    const docId = crypto.createHash('sha1').update(email).digest('hex');
    const ref = firestore.collection(COLLECTION).doc(docId);

    await ref.set({
      email,                        // version normalisée
      uid: uid || null,
      codeHash,
      attempts: 0,
      expiresAt,
      used: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ip: req.ip,
      ua: req.headers['user-agent'] || null,
    });

    // Envoi réel — si ça échoue, on renvoie 500 pour le constater côté front
    await sendResetCodeEmail(email, code, CODE_TTL_MIN);

    await auditLog(req, 'PASSWORD_FORGOT', { collection: COLLECTION, id: docId }, { email, mailOk: true }).catch(() => {});
    return res.json({ ok: true });
  } catch (e) {
    console.error('[PASSWORD] sendResetCodeEmail failed:', e?.message);
    await auditLog(req, 'PASSWORD_FORGOT', { collection: COLLECTION, id: 'n/a' }, { mailOk: false, reason: e?.message }).catch(() => {});
    return res.status(500).json({ error: 'MAIL_SEND_FAILED' });
  }
}

/**
 * POST /api/password/verify
 * body: { email, code }
 * + garde-fous: refuse si l'email est admin (même message)
 */
async function verifyResetCode(req, res) {
  const rawEmail = req.body?.email || '';
  const email = String(rawEmail).trim().toLowerCase();
  const { code } = req.body;

  const firestore = db();

  // 🔒 Refus si admin (même message)
  const qs = await firestore.collection('users').where('email', '==', email).limit(1).get();
  if (!qs.empty) {
    const role = (qs.docs[0].data() || {}).role || null;
    if (role === 'admin') {
      await auditLog(req, 'PASSWORD_VERIFY_BLOCK', { collection: 'users_by_email', id: email }, { reason: 'ADMIN_FORBIDDEN' }).catch(() => {});
      return res.status(400).json({ error: 'INVALID_CODE' }); // même rendu côté UI
    }
  }

  const salt = process.env.CODE_SALT || 'change-me';
  const codeHash = hashCode(code, salt);
  const docId = crypto.createHash('sha1').update(email).digest('hex');
  const ref = firestore.collection(COLLECTION).doc(docId);

  const snap = await ref.get();
  if (!snap.exists) return res.status(400).json({ error: 'INVALID_CODE' });

  const data = snap.data();
  if (data.used) return res.status(400).json({ error: 'CODE_ALREADY_USED' });
  if (Date.now() > (data.expiresAt || 0)) return res.status(400).json({ error: 'CODE_EXPIRED' });
  if ((data.attempts || 0) >= MAX_ATTEMPTS) return res.status(429).json({ error: 'TOO_MANY_ATTEMPTS' });

  const isMatch = data.codeHash === codeHash;

  await ref.update({
    attempts: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await auditLog(req, 'PASSWORD_VERIFY', { collection: COLLECTION, id: docId }, { ok: isMatch }).catch(() => {});
  if (!isMatch) return res.status(400).json({ error: 'INVALID_CODE' });

  return res.json({ ok: true });
}

/**
 * POST /api/password/reset
 * body: { email, code, newPassword }
 * + garde-fous: refuse si l'email est admin (même message)
 */
async function resetPassword(req, res) {
  const rawEmail = req.body?.email || '';
  const email = String(rawEmail).trim().toLowerCase();
  const { code, newPassword } = req.body;

  const firestore = db();

  // 🔒 Refus si admin (même message)
  const qs = await firestore.collection('users').where('email', '==', email).limit(1).get();
  if (!qs.empty) {
    const role = (qs.docs[0].data() || {}).role || null;
    if (role === 'admin') {
      await auditLog(req, 'PASSWORD_RESET_BLOCK', { collection: 'users_by_email', id: email }, { reason: 'ADMIN_FORBIDDEN' }).catch(() => {});
      return res.status(400).json({ error: 'INVALID_CODE' });
    }
  }

  const salt = process.env.CODE_SALT || 'change-me';
  const codeHash = hashCode(code, salt);
  const docId = crypto.createHash('sha1').update(email).digest('hex');
  const ref = firestore.collection(COLLECTION).doc(docId);

  const snap = await ref.get();
  if (!snap.exists) return res.status(400).json({ error: 'INVALID_CODE' });

  const data = snap.data();
  if (data.used) return res.status(400).json({ error: 'CODE_ALREADY_USED' });
  if (Date.now() > (data.expiresAt || 0)) return res.status(400).json({ error: 'CODE_EXPIRED' });
  if ((data.attempts || 0) >= MAX_ATTEMPTS) return res.status(429).json({ error: 'TOO_MANY_ATTEMPTS' });

  const isMatch = data.codeHash === codeHash;
  if (!isMatch) {
    await ref.update({
      attempts: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return res.status(400).json({ error: 'INVALID_CODE' });
  }

  // Met à jour le mot de passe Firebase (si l'email existe)
  let userRecord;
  try {
    userRecord = await auth().getUserByEmail(email);
  } catch (_) {
    // Email non trouvé dans Firebase: on "consomme" le code mais on ne jette pas d'erreur
    await ref.update({ used: true, updatedAt: FieldValue.serverTimestamp() });
    return res.json({ ok: true });
  }

  await auth().updateUser(userRecord.uid, { password: newPassword });
  await auth().revokeRefreshTokens(userRecord.uid);

  await ref.update({ used: true, updatedAt: FieldValue.serverTimestamp() });

  await auditLog(req, 'PASSWORD_RESET', { collection: 'users', id: userRecord.uid }, { email }).catch(() => {});
  return res.json({ ok: true });
}

module.exports = {
  sendPasswordSetupLink,
  markPasswordSet,
  requestResetCode,
  verifyResetCode,
  resetPassword,
};
