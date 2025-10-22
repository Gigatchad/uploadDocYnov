// services/notifications.js
const { admin, db } = require('../firebase');
const { FieldValue } = require('firebase-admin/firestore');

// Écrit une notification persistée
async function addNotification(payload) {
  const ref = db().collection('notifications').doc();
  const now = FieldValue.serverTimestamp();
  const data = {
    kind: payload.kind,                   // "request_submitted" | "request_approved" | "request_rejected"
    requestId: payload.requestId || null,
    status: payload.status || null,

    type: payload.type || null,
    notes: payload.notes || null,

    requestedBy: payload.requestedBy || null, // {uid,name,role}
    requestedFor: payload.requestedFor || null, // {uid,name,filiere,niveau}

    recipients: Array.isArray(payload.recipients) ? payload.recipients : [], // ex: ["role:admin","role:personnel"] ou ["uid:xxx"]
    reads: {},

    createdAt: now,
    updatedAt: now,

    approvedAt: payload.approvedAt || null,
    rejectedAt: payload.rejectedAt || null,
    rejectionReason: payload.rejectionReason || null,
  };

  await ref.set(data);
  return ref.id;
}

// Récupère les FCM tokens pour une liste d’UID
async function getTokensForUids(uids = []) {
  if (!uids.length) return [];
  const uniq = [...new Set(uids.filter(Boolean))];
  const snaps = await Promise.all(
    uniq.map((uid) => db().collection('users').doc(uid).get())
  );
  const tokens = [];
  snaps.forEach((s) => {
    if (!s.exists) return;
    const u = s.data() || {};
    const arr = Array.isArray(u.fcmTokens) ? u.fcmTokens : [];
    arr.forEach((t) => t && t.length > 10 && tokens.push(t));
  });
  return [...new Set(tokens)];
}

// Récupère les FCM tokens pour des rôles donnés (admin/personnel)
async function getTokensForRoles(roles = []) {
  if (!roles.length) return [];
  const uniq = [...new Set(roles)];
  const q = await db()
    .collection('users')
    .where('role', 'in', uniq)
    .get();

  const tokens = [];
  q.forEach((doc) => {
    const u = doc.data() || {};
    const arr = Array.isArray(u.fcmTokens) ? u.fcmTokens : [];
    arr.forEach((t) => t && t.length > 10 && tokens.push(t));
  });
  return [...new Set(tokens)];
}

// Envoi FCM multicast
async function sendFCM(tokens, { title, body, data }) {
  if (!tokens?.length) return { successCount: 0 };
  try {
    const resp = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: data || {},
    });
    return resp;
  } catch (e) {
    console.warn('[FCM] send failed:', e.message);
    return { successCount: 0, error: e };
  }
}

module.exports = {
  addNotification,
  getTokensForUids,
  getTokensForRoles,
  sendFCM,
};
