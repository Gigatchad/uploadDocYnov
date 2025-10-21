// controllers/adminController.js
const { db } = require('../firebase');

/**
 * GET /api/admin/me
 * - Réservé admin: retourne le doc Firestore users/{uid}
 */
async function getAdminMe(req, res) {
  const doc = await db().collection('users').doc(req.user.uid).get();
  if (!doc.exists) return res.status(404).json({ error: 'User not found' });
  return res.json({ id: doc.id, ...doc.data() });
}

module.exports = { getAdminMe };
