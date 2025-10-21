// routes/users.routes.js
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');

const { requireAuth } = require('../middlewares/auth');
const { requireRole } = require('../middlewares/roles');
const { handleValidation } = require('../middlewares/validate');
const { createUser, ALLOWED_NIVEAUX } = require('../controllers/usersController');

const router = Router();

const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests on /users' }
});

const common = [
  // email = email @école (login)
  body('email').isEmail().withMessage('email (login) invalide').bail().trim().isLength({ max: 254 }),
  // notifyEmail = email personnel (où envoyer le reset)
  body('notifyEmail').isEmail().withMessage('notifyEmail (personnel) invalide').bail().trim().isLength({ max: 254 }),
  body('role').isIn(['etudiant', 'parent', 'personnel']).withMessage('role invalide'),
  body('prenom').exists().isString().trim().isLength({ min: 1, max: 100 }),
  body('nom').exists().isString().trim().isLength({ min: 1, max: 100 })
];

const etudiantRules = [
  body('filiere').exists().withMessage('filiere requise').bail()
    .isString().trim().isLength({ min: 2, max: 128 }),
  body('niveau').exists().withMessage('niveau requis').bail()
    .isIn(ALLOWED_NIVEAUX).withMessage(`niveau invalide (${ALLOWED_NIVEAUX.join(', ')})`)
];

const parentRules = [
  body('parentOf').isArray({ min: 1, max: 10 }).withMessage('parentOf doit être une liste 1..10'),
  body('parentOf.*').isString().trim().isLength({ min: 6, max: 128 }) // UID Firebase d'étudiant
];

router.post(
  '/users',
  requireAuth,
  requireRole('admin'),
  limiter,
  ...common,
  async (req, res, next) => {
    const role = req.body?.role;
    if (role === 'etudiant') await Promise.all(etudiantRules.map(r => r.run(req)));
    if (role === 'parent')   await Promise.all(parentRules.map(r => r.run(req)));
    next();
  },
  handleValidation,
  createUser
);

module.exports = router;
