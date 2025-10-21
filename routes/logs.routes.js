// routes/logs.routes.js
const { Router } = require('express');
const { requireAuth } = require('../middlewares/auth');
const { requireRole } = require('../middlewares/roles');
const { db } = require('../firebase');

const router = Router();

/**
 * GET /api/logs?limit=50&action=LOGIN&actorUid=xxx&before=2025-10-01T00:00:00Z
 * - Réservé admin
 */
router.get('/logs', requireAuth, requireRole('admin'), async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const action = req.query.action || null;
  const actorUid = req.query.actorUid || null;
  const before = req.query.before ? new Date(req.query.before) : null;

  let q = db().collection('logs').orderBy('at', 'desc').limit(limit);
  if (action) q = q.where('action', '==', action);
  if (actorUid) q = q.where('actor.uid', '==', actorUid);
  if (before && !isNaN(before.getTime())) q = q.where('at', '<', before);

  const snap = await q.get();
  const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  res.json({ items, count: items.length, nextBefore: items.length ? items[items.length - 1].at : null });
});

module.exports = router;
