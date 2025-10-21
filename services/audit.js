// services/audit.js
const { db } = require('../firebase');
const { FieldValue } = require('firebase-admin/firestore');

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string') return xf.split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

/**
 * Ajoute une entrée d'audit Firestore: logs
 * @param req Express req
 * @param action string ('LOGIN', 'FCM_REGISTER', ...)
 * @param target object|null ex: { collection:'users', id:'...' }
 * @param meta object|null   ex: { tokenHash:'...' }
 */
async function auditLog(req, action, target = null, meta = null) {
  const now = FieldValue.serverTimestamp();
  const actor = req.user ? { uid: req.user.uid, role: req.user.role || null } : null;

  const entry = {
    at: now,
    action,
    actor,
    target,
    meta,
    http: {
      method: req.method,
      url: req.originalUrl,
      ip: clientIp(req),
      ua: req.headers['user-agent'] || null
    }
  };
  await db().collection('logs').add(entry);
}

module.exports = { auditLog };
