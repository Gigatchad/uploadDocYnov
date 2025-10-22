// routes/cloudinary.routes.js
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');

const { requireAuth } = require('../middlewares/auth');
const { handleValidation } = require('../middlewares/validate');
const { getSignature, deleteAsset } = require('../controllers/cloudinaryController');

const router = Router();

const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

// ⚠️ signature = OBLIGATOIRE pour upload signé depuis le front
router.post('/cloudinary/signature', requireAuth, limiter, getSignature);

// (optionnel) supprimer un asset
router.delete(
  '/cloudinary/asset',
  requireAuth,
  limiter,
  body('publicId').isString().isLength({ min: 3 }),
  body('resourceType').optional().isIn(['image', 'video', 'raw']),
  handleValidation,
  deleteAsset
);

module.exports = router;
