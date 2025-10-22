// routes/auth.invite.routes.js
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const { handleValidation } = require('../middlewares/validate');
const { setInitialPassword } = require('../controllers/authInviteController');

const router = Router();

const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' }
});

router.post(
  '/auth/initial-password',
  limiter,
  body('token').isString().isLength({ min: 20 }),
  body('email').isEmail(),
  body('password').isString().isLength({ min: 8 }),
  handleValidation,
  setInitialPassword
);

module.exports = router;
