// controllers/usersController.js
const { auth, db } = require('../firebase');
const { auditLog } = require('../services/audit');
const { FieldValue } = require('firebase-admin/firestore');
const { sendAccessEmail } = require('../services/mailer');
const { createInviteToken } = require('../services/invite');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const ALLOWED_NIVEAUX = ['B1', 'B2', 'B3', 'M1', 'M2'];

function displayNameOf(prenom, nom) {
  const p = (prenom || '').trim();
  const n = (nom || '').trim();
  return [p, n].filter(Boolean).join(' ') || null;
}

/**
 * POST /api/users  (ADMIN)
 * body commun: { email (login), notifyEmail (perso), role, prenom, nom }
 * étudiant: { filiere, niveau } ; parent: { parentOf:[uid,...] }
 */
async function createUser(req, res) {
  const { role, email, notifyEmail, prenom, nom, filiere, niveau, parentOf } = req.body || {};

  const a = auth();
  const firestore = db();

  // Règles
  if (!email || !notifyEmail || !role) return res.status(400).json({ error: 'MISSING_FIELDS' });

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

  // collision email (login)
  try {
    const existing = await a.getUserByEmail(email);
    if (existing) return res.status(409).json({ error: 'email (login) déjà utilisé' });
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
  }

  const displayName = displayNameOf(prenom, nom);
  const displayNameLower = displayName ? displayName.toLowerCase() : null;

  // 1) créer Auth
  let createdUser;
  try {
    createdUser = await a.createUser({
      email,
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

  // 3) Firestore (transaction si parent)
  try {
    const baseDoc = {
      role,
      email,                      // login
      notifyEmail,                // perso
      prenom: prenom || null,
      nom: nom || null,
      displayName: displayName || null,
      displayNameLower,
      fcmTokens: [],
      passwordSetAt: null,        // rempli après création du mot de passe
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };

    if (role === 'etudiant') {
      await firestore.collection('users').doc(uid)
        .set({ ...baseDoc, filiere, niveau, parentUid: null }, { merge: true });

    } else if (role === 'personnel') {
      await firestore.collection('users').doc(uid).set(baseDoc, { merge: true });

    } else if (role === 'parent') {
      await firestore.runTransaction(async (tx) => {
        const parentRef = firestore.collection('users').doc(uid);

        // Lire tous les enfants et valider exclusivité
        const childRefs = parentOf.map((childUid) => firestore.collection('users').doc(childUid));
        const childSnaps = await Promise.all(childRefs.map((ref) => tx.get(ref)));

        childSnaps.forEach((snap, idx) => {
          const childUid = parentOf[idx];
          if (!snap.exists) throw new Error(`Etudiant ${childUid} introuvable`);
          const child = snap.data();
          if (child.role !== 'etudiant') throw new Error(`UID ${childUid} n'est pas un etudiant`);
          if (child.parentUid && child.parentUid !== null) {
            throw new Error(`Etudiant ${childUid} déjà associé à un parent`);
          }
        });

        // Ecrire parent + attacher enfants
        tx.set(parentRef, { ...baseDoc, parentOf }, { merge: true });
        childRefs.forEach((ref) => {
          tx.update(ref, { parentUid: uid, updatedAt: FieldValue.serverTimestamp() });
        });
      });
    }
  } catch (e) {
    try { await a.deleteUser(uid); } catch (_) {}
    return res.status(500).json({ error: 'PERSISTENCE_FAILED', details: e.message });
  }

  // 4) Notre lien d’invitation → vers /new-user?t=...
  let inviteLink = null;
  try {
    const token = await createInviteToken({ uid, email, ttlHours: 48 });
    inviteLink = `${FRONTEND_URL}/new-user?t=${encodeURIComponent(token)}`;
  } catch (_) { /* non bloquant */ }

  // 5) Email d’accès (avec NOTRE lien)
  try {
    await sendAccessEmail(notifyEmail, { loginEmail: email, resetLink: inviteLink });
    await auditLog(req, 'EMAIL_SEND', { collection: 'users', id: uid }, { to: notifyEmail, type: 'welcome' });
  } catch (_) {}

  // 6) Audit création
  const meta = { role, email, notifyEmail };
  if (role === 'etudiant') Object.assign(meta, { filiere, niveau });
  if (role === 'parent') Object.assign(meta, { parentOf });
  await auditLog(req, 'USER_CREATE', { collection: 'users', id: uid }, meta);

  return res.status(201).json({
    uid, role, email, notifyEmail, inviteLink
  });
}

module.exports = { createUser, ALLOWED_NIVEAUX };
