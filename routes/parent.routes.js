// routes/parent.routes.js
const { Router } = require('express');
const { requireAuth } = require('../middlewares/auth');
const { requireRole } = require('../middlewares/roles');
const { getMyChildren } = require('../controllers/parentController');

const router = Router();

// ⚠️ accessible uniquement au parent connecté
router.get(
  '/parent/children',
  requireAuth,
  requireRole('parent'),
  getMyChildren
);

module.exports = router;
