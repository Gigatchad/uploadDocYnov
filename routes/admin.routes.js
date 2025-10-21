// routes/admin.routes.js
const { Router } = require('express');
const { requireAuth } = require('../middlewares/auth');
const { requireRole } = require('../middlewares/roles');
const { getAdminMe } = require('../controllers/adminController');

const router = Router();

router.get('/admin/me', requireAuth, requireRole('admin'), getAdminMe);

module.exports = router;
