// routes/users.routes.js
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { query, body } = require('express-validator');

const { requireAuth } = require('../middlewares/auth');
const { requireRole } = require('../middlewares/roles');
const { handleValidation } = require('../middlewares/validate');

const { createUser, ALLOWED_NIVEAUX } = require('../controllers/usersController');
const { listStudentsMinimal, listUsersFull } = require('../controllers/usersQueryController');

const router = Router();

const limiterRead = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' }
});
const limiterWrite = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' }
});

// ---------- CREATE (POST /api/users) ----------
router.post(
  '/users',
  requireAuth,
  requireRole('admin'),
  limiterWrite,
  body('email').isEmail().isLength({ max: 254 }),
  body('notifyEmail').isEmail().isLength({ max: 254 }),
  body('role').isIn(['etudiant','parent','personnel']),
  body('prenom').optional().isString().trim().isLength({ max: 100 }),
  body('nom').optional().isString().trim().isLength({ max: 100 }),
  body('filiere').optional().isString().trim().isLength({ min: 1, max: 128 }),
  body('niveau').optional().isIn(ALLOWED_NIVEAUX),
  body('parentOf').optional().isArray({ min: 0, max: 10 }),
  body('parentOf.*').optional().isString().trim().isLength({ min: 6, max: 128 }),
  handleValidation,
  createUser
);

// ---------- LIST STUDENTS MIN (GET /api/users/etudiants/min) ----------
router.get(
  '/users/etudiants/min',
  requireAuth,
  requireRole('admin'),
  limiterRead,
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('cursor').optional().isString(),
  query('q').optional().isString(),
  query('availableOnly').optional().isBoolean().toBoolean(),
  handleValidation,
  listStudentsMinimal
);

// ---------- LIST FULL (GET /api/users/full) ----------
router.get(
  '/users/full',
  requireAuth,
  requireRole('admin'),
  limiterRead,
  query('role').optional().isIn(['etudiant','parent','personnel']),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('cursor').optional().isString(),
  handleValidation,
  listUsersFull
);

module.exports = router;
