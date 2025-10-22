// controllers/parentController.js
const { db } = require('../firebase');
const { auditLog } = require('../services/audit');

/** On ne renvoie qu'un "preview" non sensible de l'étudiant */
function pickUserPreview(u = {}, uid) {
  const displayName =
    u.displayName ||
    [u.prenom, u.nom].filter(Boolean).join(' ') ||
    null;

  return {
    uid,
    prenom: u.prenom || null,
    nom: u.nom || null,
    displayName,
    email: u.email || null,
    notifyEmail: u.notifyEmail || null,
    niveau: u.niveau || null,
    filiere: u.filiere || null,
    photoURL: u.photoURL || null, // si tu stockes l’avatar
    lastLoginAt: u.lastLoginAt || null,
    // ⚠️ pas de fcmTokens / infos sensibles ici
  };
}

/**
 * GET /api/parent/children
 * Auth: parent connecté
 * Query optionnelle: ?search=...
 */
async function getMyChildren(req, res) {
  const firestore = db();
  const parentUid = req.user?.uid;

  // Charger le parent
  const parentSnap = await firestore.collection('users').doc(parentUid).get();
  if (!parentSnap.exists) return res.status(404).json({ error: 'USER_NOT_FOUND' });

  const parent = parentSnap.data() || {};
  if (parent.role !== 'parent') return res.status(403).json({ error: 'FORBIDDEN' });

  // 1) UIDs depuis le champ parentOf[]
  const fromArray = Array.isArray(parent.parentOf) ? parent.parentOf.filter(Boolean) : [];

  // 2) UIDs depuis la requête Firestore parentUid == parentUid
  const byQuerySnap = await firestore.collection('users')
    .where('parentUid', '==', parentUid)
    .get();
  const fromQuery = byQuerySnap.docs.map(d => d.id);

  // Fusion + déduplication
  const allIds = Array.from(new Set([...fromArray, ...fromQuery]));
  if (allIds.length === 0) {
    auditLog(req, 'PARENT_CHILDREN_EMPTY', { collection: 'users', id: parentUid }, {}).catch(() => {});
    return res.json({ ok: true, items: [] });
  }

  // Firestore: on batch en petits paquets pour éviter les limites
  const CHUNK = 10;
  const chunks = [];
  for (let i = 0; i < allIds.length; i += CHUNK) chunks.push(allIds.slice(i, i + CHUNK));

  const items = [];
  for (const chunk of chunks) {
    const refs = chunk.map(id => firestore.collection('users').doc(id));
    // Admin SDK: firestore.getAll(...refs)
    const snaps = await firestore.getAll(...refs);
    snaps.forEach(s => {
      if (s.exists) {
        const u = s.data() || {};
        if (u.role === 'etudiant') {
          items.push(pickUserPreview(u, s.id));
        }
      }
    });
  }

  // Filtre côté serveur (optionnel)
  const q = String(req.query.search || '').trim().toLowerCase();
  const filtered = q
    ? items.filter(it =>
        (it.displayName || '').toLowerCase().includes(q) ||
        (it.prenom || '').toLowerCase().includes(q) ||
        (it.nom || '').toLowerCase().includes(q) ||
        (it.email || '').toLowerCase().includes(q)
      )
    : items;

  auditLog(req, 'PARENT_CHILDREN_LIST', { collection: 'users', id: parentUid }, { count: filtered.length }).catch(() => {});
  return res.json({ ok: true, items: filtered });
}

module.exports = { getMyChildren };
