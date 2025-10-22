// routes/password.routes.js
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');

const { requireAuth } = require('../middlewares/auth');
const { requireRole } = require('../middlewares/roles');
const { handleValidation } = require('../middlewares/validate');

const {
  // EXISTANTS
  sendPasswordSetupLink,
  markPasswordSet,
  // NOUVEAUX
  requestResetCode,
  verifyResetCode,
  resetPassword,
} = require('../controllers/passwordController');

const router = Router();

const limiterTight = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' }
});

// Un peu plus “large” pour le flux public (forgot/verify/reset)
const limiterPublic = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' }
});

/** ========== ADMIN (EXISTANTS) ========== */

/** POST /api/password/send-link (admin) */
router.post(
  '/password/send-link',
  requireAuth,
  requireRole('admin'),
  limiterTight,
  body('email').isEmail(),
  body('continueUrl').optional().isString(),
  handleValidation,
  sendPasswordSetupLink
);

/** POST /api/password/mark-set (user connecté) */
router.post(
  '/password/mark-set',
  requireAuth,
  limiterTight,
  body('uid').optional().isString(),
  handleValidation,
  markPasswordSet
);

/** ========== PUBLIC (NOUVEAU FLUX CODE 6 CHIFFRES) ========== */

/** POST /api/password/forgot  -> envoie un code 6 chiffres par e-mail */
router.post(
  '/password/forgot',
  limiterPublic,
  body('email').isEmail().normalizeEmail(),
  handleValidation,
  requestResetCode
);

/** POST /api/password/verify  -> vérifie le code */
router.post(
  '/password/verify',
  limiterPublic,
  body('email').isEmail().normalizeEmail(),
  body('code').isString().isLength({ min: 6, max: 6 }),
  handleValidation,
  verifyResetCode
);

/** POST /api/password/reset   -> vérifie code + change le mot de passe */
router.post(
  '/password/reset',
  limiterPublic,
  body('email').isEmail().normalizeEmail(),
  body('code').isString().isLength({ min: 6, max: 6 }),
  body('newPassword').isString().isLength({ min: 8, max: 128 }),
  handleValidation,
  resetPassword
);

module.exports = router;
