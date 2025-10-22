// routes/session.routes.js
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');

const { requireAuth } = require('../middlewares/auth');
const { handleValidation } = require('../middlewares/validate');

const {
  getMe,
  registerFcmToken,
  unregisterFcmToken,
  logSignIn,
} = require('../controllers/sessionController');

const router = Router();

const limiterRead = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

const limiterWrite = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

// --------- Qui suis-je ? (profil + rôle) ---------
router.get('/me', requireAuth, limiterRead, getMe);

// --------- FCM register/unregister ---------
router.post(
  '/fcm/register',
  requireAuth,
  limiterWrite,
  body('token').isString().isLength({ min: 10 }),
  handleValidation,
  registerFcmToken
);

router.post(
  '/fcm/unregister',
  requireAuth,
  limiterWrite,
  body('token').isString().isLength({ min: 10 }),
  handleValidation,
  unregisterFcmToken
);

// --------- Log de connexion (optionnel) ---------
router.post(
  '/session/log-signin',
  requireAuth,
  limiterWrite,
  body('provider').optional().isString().isLength({ max: 64 }),
  body('deviceInfo').optional().isString().isLength({ max: 256 }),
  handleValidation,
  logSignIn
);

module.exports = router;
