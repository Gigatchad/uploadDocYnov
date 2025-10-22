// controllers/notificationsController.js
const { db } = require('../firebase');
const { FieldValue } = require('firebase-admin/firestore');

// GET /api/notifications?scope=admin|personnel|mine&limit=100
// - Staff (role 'admin' ou 'personnel'):
//     scope=mine → feed perso (uid:<uid>)
//     scope=admin ou scope=personnel ou vide → feed staff (role:<role>)
// - Public (etudiant/parent): feed perso (uid:<uid>)
async function listNotifications(req, res) {
  const firestore = db();
  const role = req.user.role; // 'admin' | 'personnel' | 'parent' | 'etudiant'
  const uid = req.user.uid;
  const scope = (req.query.scope || '').toLowerCase(); // '', 'admin', 'personnel', 'mine'
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 200);

  let query = firestore.collection('notifications');

  if (['admin', 'personnel'].includes(role) && scope !== 'mine') {
    // feed staff par défaut si scope vide
    query = query.where('recipients', 'array-contains', `role:${role}`);
  } else {
    // feed perso
    query = query.where('recipients', 'array-contains', `uid:${uid}`);
  }

  const snap = await query.orderBy('createdAt', 'desc').limit(limit).get();
  const items = [];
  snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
  res.json({ items });
}

// PATCH /api/notifications/:id/read
async function markRead(req, res) {
  const firestore = db();
  const { id } = req.params;
  const uid = req.user.uid;

  const ref = firestore.collection('notifications').doc(id);
  await ref.set({ reads: { [uid]: FieldValue.serverTimestamp() } }, { merge: true });
  res.json({ ok: true });
}

module.exports = { listNotifications, markRead };
