// routes/auth.routes.js
const { Router } = require('express');
const { requireAuth } = require('../middlewares/auth');
const { me, registerFcmToken } = require('../controllers/authController');

const router = Router();

router.get('/me', requireAuth, me);
router.post('/me/fcm', requireAuth, registerFcmToken);

module.exports = router;
