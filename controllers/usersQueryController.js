// controllers/usersQueryController.js
const { db, admin } = require('../firebase');

const MAX_LIMIT = 100;
const clampLimit = (v) =>
  Math.min(Math.max(parseInt(v || '20', 10) || 20, 1), MAX_LIMIT);

/**
 * GET /api/users/etudiants/min?limit=&cursor=&q=&availableOnly=true
 * - Liste courte d'étudiants (pour picker)
 */
async function listStudentsMinimal(req, res) {
  try {
    const limit = clampLimit(req.query.limit);
    const cursor = req.query.cursor ? String(req.query.cursor) : null;
    const qStr = req.query.q ? String(req.query.q).toLowerCase() : null;
    const availableOnly =
      (req.query.availableOnly ?? 'true').toString().toLowerCase() !== 'false';

    let q = db().collection('users').where('role', '==', 'etudiant');
    if (availableOnly) q = q.where('parentUid', '==', null);
    q = q.orderBy('displayNameLower', 'asc');

    if (cursor) q = q.startAfter(cursor);
    q = q.limit(limit);

    const snap = await q.get();

    let items = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        prenom: data.prenom || null,
        nom: data.nom || null,
        displayName:
          data.displayName ||
          [data.prenom, data.nom].filter(Boolean).join(' ') ||
          data.email,
      };
    });

    if (qStr) {
      items = items.filter(
        (it) =>
          (it.displayName || '').toLowerCase().startsWith(qStr) ||
          (it.nom || '').toLowerCase().startsWith(qStr) ||
          (it.prenom || '').toLowerCase().startsWith(qStr)
      );
    }

    const last = snap.docs[snap.docs.length - 1];
    const nextCursor = last
      ? (last.get('displayNameLower') ||
          (last.get('displayName') || '')).toLowerCase()
      : null;

    const hasMore = items.length === limit && Boolean(nextCursor);

    return res.json({ items, nextCursor, availableOnly, hasMore });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'SERVER_ERROR', details: e.message });
  }
}

/**
 * GET /api/users/full?role=&limit=&cursor=
 * - Liste complète (sauf admin)
 * - Tri par createdAt desc
 */
async function listUsersFull(req, res) {
  try {
    const { role } = req.query;
    const limit = clampLimit(req.query.limit);
    const cursorMs = req.query.cursor ? Number(req.query.cursor) : null;

    let q;
    if (role && ['etudiant', 'parent', 'personnel'].includes(role)) {
      q = db().collection('users').where('role', '==', role);
    } else {
      q = db().collection('users').where('role', 'in', ['etudiant', 'parent', 'personnel']);
    }

    q = q.orderBy('createdAt', 'desc');

    if (cursorMs && cursorMs > 0) {
      const ts = admin.firestore.Timestamp.fromMillis(cursorMs);
      q = q.startAfter(ts);
    }

    q = q.limit(limit);

    const snap = await q.get();
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const last = snap.docs[snap.docs.length - 1];
    const nextCursor = last?.get('createdAt')
      ? last.get('createdAt').toMillis()
      : null;

    const hasMore = items.length === limit && Boolean(nextCursor);

    return res.json({ items, nextCursor, hasMore });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'SERVER_ERROR', details: e.message });
  }
}

module.exports = { listStudentsMinimal, listUsersFull };
