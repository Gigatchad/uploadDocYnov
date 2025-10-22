// routes/requests.routes.js
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const multer = require('multer');

const { requireAuth } = require('../middlewares/auth');
const { handleValidation } = require('../middlewares/validate');
const {
  listRequests,
  createRequest,
  updateRequestStatus,
  notifyDocumentSent,
  uploadRequestDocument,
  getRequestDownload,
  listMySentDocuments,   // ⬅️ nouveau
} = require('../controllers/requestsController');

const router = Router();

// Anti-spam raisonnable (10 min / 120 req)
const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

// Multer: stockage mémoire pour streamer directement vers Cloudinary
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

/**
 * GET /api/requests?scope=admin|mine&status=&limit=100
 * - Admin/Personnel (scope=admin par défaut) → contrôleur renvoie seulement approved + sent
 * - Parent/Étudiant (scope=mine) → seulement leurs demandes (peut passer status=sent)
 */
router.get(
  '/requests',
  requireAuth,
  limiter,
  query('scope')
    .optional()
    .customSanitizer((v) => (v && v.toLowerCase() === 'personnel' ? 'admin' : v))
    .isIn(['admin', 'mine']),
  query('status').optional().isIn(['pending', 'in_progress', 'approved', 'rejected', 'sent']),
  query('limit').optional().isInt({ min: 1, max: 200 }),
  handleValidation,
  listRequests
);

/**
 * (Optionnel/Convenance) GET /api/my/sent-documents
 * → équivalent à /api/requests?scope=mine&status=sent
 */
router.get(
  '/my/sent-documents',
  requireAuth,
  limiter,
  listMySentDocuments
);

/**
 * POST /api/requests
 * Crée une demande (étudiant/parent)
 */
router.post(
  '/requests',
  requireAuth,
  limiter,
  body('type').optional().isString().isLength({ max: 128 }),
  body('studentUid').optional().isString().isLength({ min: 10, max: 128 }),
  body('notes').optional().isString().isLength({ max: 1000 }),
  body('deliveryMethod').optional().isString().isLength({ max: 32 }),
  body('targetEmail').optional().isEmail().isLength({ max: 256 }),
  body('attachments').optional().isArray({ max: 6 }),
  body('attachments.*.publicId').optional().isString().isLength({ max: 256 }),
  body('attachments.*.secureUrl').optional().isString().isLength({ max: 1024 }),
  body('attachments.*.mimeType').optional().isString().isLength({ max: 64 }),
  body('attachments.*.originalFilename').optional().isString().isLength({ max: 256 }),
  handleValidation,
  createRequest
);

/**
 * PATCH /api/requests/:id/status
 * Change le statut (admin/personnel) → { status: "approved"|"rejected", rejectionReason? }
 */
router.patch(
  '/requests/:id/status',
  requireAuth,
  limiter,
  param('id').isString().isLength({ min: 6, max: 128 }),
  body('status').isIn(['approved', 'rejected']),
  body('rejectionReason').optional().isString().isLength({ max: 1000 }),
  handleValidation,
  updateRequestStatus
);

/**
 * PATCH /api/requests/:id/document
 * Émet une notification "document_sent" (sans upload)
 */
router.patch(
  '/requests/:id/document',
  requireAuth,
  limiter,
  param('id').isString().isLength({ min: 6, max: 128 }),
  body('notes').optional().isString().isLength({ max: 1000 }),
  handleValidation,
  notifyDocumentSent
);

/**
 * POST /api/requests/:id/upload  (multipart/form-data)
 * file: "file", notes?: string, notify?: boolean
 * - notify=true → passe en "sent" + notifs
 */
router.post(
  '/requests/:id/upload',
  requireAuth,
  limiter,
  param('id').isString().isLength({ min: 6, max: 128 }),
  upload.single('file'),
  body('notes').optional().isString().isLength({ max: 1000 }),
  body('notify').optional().isBoolean().toBoolean(),
  handleValidation,
  uploadRequestDocument
);

/**
 * GET /api/requests/:id/download
 * Retourne { ok: true, url, filename } si un fichier est disponible
 */
router.get(
  '/requests/:id/download',
  requireAuth,
  limiter,
  param('id').isString().isLength({ min: 6, max: 128 }),
  handleValidation,
  getRequestDownload
);

module.exports = router;
