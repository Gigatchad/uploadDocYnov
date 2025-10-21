// routes/users.mutations.routes.js
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { body, param } = require('express-validator');

const { requireAuth } = require('../middlewares/auth');
const { requireRole } = require('../middlewares/roles');
const { handleValidation } = require('../middlewares/validate');
const { ALLOWED_NIVEAUX } = require('../controllers/usersController');
const { updateUser, deleteUser } = require('../controllers/usersMutations');

const router = Router();

const limiterMut = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' }
});

// PATCH /api/users/:uid  (update)
// - pour un parent: passer parentOf:[...] pour ATTACH/DETACH des enfants
router.patch(
  '/users/:uid',
  requireAuth,
  requireRole('admin'),
  limiterMut,
  param('uid').isString().isLength({ min: 6 }),
  body('email').optional().isEmail().isLength({ max: 254 }),
  body('notifyEmail').optional().isEmail().isLength({ max: 254 }),
  body('prenom').optional().isString().trim().isLength({ max: 100 }),
  body('nom').optional().isString().trim().isLength({ max: 100 }),
  body('filiere').optional().isString().trim().isLength({ min: 1, max: 128 }),
  body('niveau').optional().isIn(ALLOWED_NIVEAUX),
  body('parentOf').optional().isArray({ min: 0, max: 10 }),
  body('parentOf.*').optional().isString().trim().isLength({ min: 6, max: 128 }),
  handleValidation,
  updateUser
);

// DELETE /api/users/:uid
// - parent: supprime et DETACHE automatiquement les enfants
// - étudiant rattaché: 409 DETACH_REQUIRED
router.delete(
  '/users/:uid',
  requireAuth,
  requireRole('admin'),
  limiterMut,
  param('uid').isString().isLength({ min: 6 }),
  handleValidation,
  deleteUser
);

module.exports = router;
