// controllers/usersController.js
const { auth, db } = require('../firebase');
const { auditLog } = require('../services/audit');
const { FieldValue } = require('firebase-admin/firestore');
const { sendAccessEmail } = require('../services/mailer');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const ALLOWED_NIVEAUX = ['Licence', 'Master', 'Cycle ingénieur', 'MBA']; // adapte si besoin

function displayNameOf(prenom, nom) {
  const p = (prenom || '').trim();
  const n = (nom || '').trim();
  return [p, n].filter(Boolean).join(' ') || null;
}

/**
 * POST /api/users (ADMIN ONLY)
 * body commun:
 *  - email        (obligatoire) = email @école (login Firebase)
 *  - notifyEmail  (obligatoire) = email personnel (destinataire du mail)
 *  - role: 'etudiant'|'parent'|'personnel'
 *  - prenom, nom
 * body étudiant: { filiere, niveau }
 * body parent:   { parentOf: [uidEtudiant, ...] }  // exclusivité: un seul parent par étudiant
 */
async function createUser(req, res) {
  const { role, email, notifyEmail, prenom, nom, filiere, niveau, parentOf } = req.body || {};

  const a = auth();
  const firestore = db();

  // Règles métier
  if (role === 'etudiant') {
    if (!filiere) return res.status(400).json({ error: 'filiere requise' });
    if (!niveau || !ALLOWED_NIVEAUX.includes(niveau)) {
      return res.status(400).json({ error: `niveau invalide (attendu: ${ALLOWED_NIVEAUX.join(', ')})` });
    }
  }
  if (role === 'parent') {
    if (!Array.isArray(parentOf) || parentOf.length < 1) {
      return res.status(400).json({ error: 'parentOf[] requis (>= 1 uid étudiant)' });
    }
    if (parentOf.length > 10) {
      return res.status(400).json({ error: 'parentOf: maximum 10 étudiants' });
    }
  }

  // collision email (sur l'email @école = login)
  try {
    const existing = await a.getUserByEmail(email);
    if (existing) return res.status(409).json({ error: 'email (login) déjà utilisé' });
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
  }

  const displayName = displayNameOf(prenom, nom);
  const displayNameLower = displayName ? displayName.toLowerCase() : null;

  // 1) Crée l'utilisateur Auth avec l'email @école (sans mot de passe)
  let createdUser;
  try {
    createdUser = await a.createUser({
      email, // <— LOGIN = email @école
      displayName: displayName || undefined,
      emailVerified: false,
      disabled: false
    });
  } catch (e) {
    return res.status(400).json({ error: 'AUTH_CREATE_FAILED', details: e.message });
  }
  const uid = createdUser.uid;

  // 2) Custom claims
  const claims = { role };
  if (role === 'parent') claims.parentOf = parentOf;
  try {
    await a.setCustomUserClaims(uid, claims);
  } catch (e) {
    try { await a.deleteUser(uid); } catch (_) {}
    return res.status(500).json({ error: 'CLAIMS_SET_FAILED', details: e.message });
  }

  // 3) Firestore (transaction si parent) — stocke email (login) + notifyEmail (personnel)
  try {
    const userDoc = {
      role,
      email,                      // login (@école)
      notifyEmail: notifyEmail,   // contact (personnel)
      prenom: prenom || null,
      nom: nom || null,
      displayName: displayName || null,
      displayNameLower,
      fcmTokens: [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };

    if (role === 'etudiant') {
      Object.assign(userDoc, { filiere, niveau, parentUid: null });
      await firestore.collection('users').doc(uid).set(userDoc, { merge: true });
    } else if (role === 'personnel') {
      await firestore.collection('users').doc(uid).set(userDoc, { merge: true });
    } else if (role === 'parent') {
      await firestore.runTransaction(async (tx) => {
        const parentRef = firestore.collection('users').doc(uid);
        tx.set(parentRef, { ...userDoc, parentOf }, { merge: true });

        for (const childUid of parentOf) {
          const childRef = firestore.collection('users').doc(childUid);
          const childSnap = await tx.get(childRef);
          if (!childSnap.exists) throw new Error(`Etudiant ${childUid} introuvable`);
          const child = childSnap.data();
          if (child.role !== 'etudiant') throw new Error(`UID ${childUid} n'est pas un etudiant`);
          if (child.parentUid && child.parentUid !== null) throw new Error(`Etudiant ${childUid} déjà associé à un parent`);
          tx.update(childRef, { parentUid: uid, updatedAt: FieldValue.serverTimestamp() });
        }
      });
    }
  } catch (e) {
    try { await a.deleteUser(uid); } catch (_) {}
    return res.status(500).json({ error: 'PERSISTENCE_FAILED', details: e.message });
  }

  // 4) Reset link — généré pour l'email de login (@école)
  let resetLink = null;
  try {
    resetLink = await a.generatePasswordResetLink(email, { url: FRONTEND_URL });
  } catch (e) {
    resetLink = null; // non bloquant
  }

  // 5) Envoi d'email — vers l'email personnel (notifyEmail)
 try {
  await sendAccessEmail(notifyEmail, { loginEmail: email, resetLink });
  await auditLog(req, 'EMAIL_SEND', { collection: 'users', id: uid }, { to: notifyEmail, type: 'welcome' });
} catch (_) {
    // non bloquant
  }

  // 6) Log de création (action)
  const meta = { role, email, notifyEmail };
  if (role === 'etudiant') Object.assign(meta, { filiere, niveau });
  if (role === 'parent') Object.assign(meta, { parentOf });
  await auditLog(req, 'USER_CREATE', { collection: 'users', id: uid }, meta);

  return res.status(201).json({
    uid,
    role,
    email,               // login @école
    notifyEmail,         // contact personnel
    resetLink
  });
}

module.exports = { createUser, ALLOWED_NIVEAUX };
