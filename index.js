// index.js
require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const hpp = require('hpp');
const rateLimit = require('express-rate-limit');

const { initFirebase } = require('./firebase');
const usersRoutes = require('./routes/users.routes');
const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const logsRoutes = require('./routes/logs.routes');
const usersQueryRoutes = require('./routes/users.query.routes');
initFirebase();

const app = express();

// Sécurité "dev raisonnable"
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, referrerPolicy: { policy: 'no-referrer' } }));

// CORS: autorise ton front en dev
const whitelist = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin || whitelist.includes(origin)) return cb(null, true);
    cb(new Error(`Origin not allowed: ${origin}`));
  },
  credentials: true
}));

// Anti-abus & hygiène
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false }));
app.use(hpp());
app.use(compression());

// Parsing
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));

// Logs HTTP
app.use(morgan('dev'));

// Routes
app.use('/api', authRoutes);
app.use('/api', adminRoutes);
app.use('/api', logsRoutes);
app.use('/api', usersRoutes);
app.use('/api', usersQueryRoutes);
// 404 & erreurs simples
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`✅ API running on http://localhost:${port}`));
