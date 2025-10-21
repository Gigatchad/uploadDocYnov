// routes/index.js
const { Router } = require('express');
const router = Router();

// Route de santé (pour vérifier que l'app tourne)
router.get('/health', (req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || 'development' });
});



module.exports = router;
