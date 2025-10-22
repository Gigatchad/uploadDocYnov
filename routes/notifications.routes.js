// routes/notifications.routes.js
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { param, query } = require('express-validator');
const { requireAuth } = require('../middlewares/auth');
const { handleValidation } = require('../middlewares/validate');
const { listNotifications, markRead } = require('../controllers/notificationsController');

const router = Router();

const limiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

router.get(
  '/notifications',
  requireAuth,
  limiter,
  // accepte 'personnel' pour éviter les 400, et 'admin'/'mine'
  query('scope').optional().isIn(['admin', 'personnel', 'mine']),
  query('limit').optional().isInt({ min: 1, max: 200 }),
  handleValidation,
  listNotifications
);

router.patch(
  '/notifications/:id/read',
  requireAuth,
  limiter,
  param('id').isString().isLength({ min: 6, max: 128 }),
  handleValidation,
  markRead
);

module.exports = router;
