const { db } = require('../firebase');
const { FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');

function genToken() {
  return crypto.randomBytes(32).toString('hex'); // 64 chars
}

/**
 * Crée un token d'invitation valable N heures
 */
async function createInviteToken({ uid, email, ttlHours = 48 }) {
  const token = genToken();
  const expiresAt = Date.now() + ttlHours * 3600 * 1000;

  await db().collection('inviteTokens').doc(token).set({
    uid,
    email,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt, // en ms (epoch)
    used: false
  });

  return token;
}

/**
 * Consomme un token (si valide) -> retourne { uid, email }
 */
async function consumeInviteToken(token, email) {
  const ref = db().collection('inviteTokens').doc(token);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('TOKEN_NOT_FOUND');

    const data = snap.data();
    if (data.used) throw new Error('TOKEN_ALREADY_USED');

    const now = Date.now();
    if (typeof data.expiresAt !== 'number' || now > data.expiresAt) {
      throw new Error('TOKEN_EXPIRED');
    }
    if (email && data.email && data.email.toLowerCase() !== String(email).toLowerCase()) {
      throw new Error('EMAIL_MISMATCH');
    }

    tx.update(ref, { used: true, usedAt: FieldValue.serverTimestamp() });
    return { uid: data.uid, email: data.email };
  });
}

module.exports = { createInviteToken, consumeInviteToken };
