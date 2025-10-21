// routes/users.query.routes.js
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { query } = require('express-validator');

const { requireAuth } = require('../middlewares/auth');
const { requireRole } = require('../middlewares/roles');
const { handleValidation } = require('../middlewares/validate');
const {
  listStudentsMinimal,
  listUsersFull,
} = require('../controllers/usersQueryController');

const router = Router();

const readLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});

const commonRead = [
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('cursor').optional().isString().trim().isLength({ min: 1 }),
];

// A) Étudiants (picker) — par défaut: only available (non rattachés)
router.get(
  '/users/etudiants/min',
  requireAuth,
  requireRole('admin'),
  readLimiter,
  ...commonRead,
  query('q').optional().isString().trim().isLength({ min: 1, max: 100 }),
  query('availableOnly')
    .optional()
    .isBoolean()
    .withMessage('availableOnly doit être true/false'),
  handleValidation,
  listStudentsMinimal
);

// B) Users full (sauf admin)
router.get(
  '/users/full',
  requireAuth,
  requireRole('admin'),
  readLimiter,
  ...commonRead,
  query('role').optional().isIn(['etudiant', 'parent', 'personnel']),
  handleValidation,
  listUsersFull
);

module.exports = router;
