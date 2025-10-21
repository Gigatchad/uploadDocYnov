// middlewares/security.js
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const hpp = require('hpp');
const rateLimit = require('express-rate-limit');

/**
 * CORS = qui a le droit d’appeler ton API depuis le navigateur.
 * En DEV: autorise uniquement ton front React (localhost:5173 ou 3000).
 */
function buildCors() {
  const whitelist = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const options = {
    origin(origin, cb) {
      // Postman/cURL (pas d'origin) = OK ; front autorisé = OK ; sinon = bloqué
      if (!origin || whitelist.includes(origin)) return cb(null, true);
      cb(new Error(`Origin non autorisée: ${origin}`));
    },
    credentials: true,
    methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization','X-Request-Id'],
    exposedHeaders: ['Content-Disposition','X-Request-Id'],
    maxAge: 86400
  };
  return cors(options);
}

/**
 * Helmet = ajoute des en-têtes de sécu (anti XSS/Clickjacking/etc.)
 * On désactive CSP pour une API (pas de HTML à servir).
 */
function buildHelmet() {
  return helmet({
    contentSecurityPolicy: false,
    frameguard: { action: 'deny' },         // empêche l’API d’être dans une iframe
    referrerPolicy: { policy: 'no-referrer' }
  });
}

/**
 * Rate Limit = évite le spam (ex: 600 req / 15min / IP).
 */
function buildRateLimiter() {
  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
  const max = Number(process.env.RATE_LIMIT_MAX || 600);
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, slow down.' }
  });
}

module.exports = {
  buildCors,
  buildHelmet,
  buildRateLimiter,
  hpp,
  compression
};
