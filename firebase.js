// firebase.js
const admin = require('firebase-admin');
const { resolve } = require('path');

let app;

/**
 * Initialise Firebase Admin.
 * Priorité:
 * 1) GOOGLE_APPLICATION_CREDENTIALS (ADC)
 * 2) SERVICE_ACCOUNT_JSON (contenu JSON en env, stringifiée)
 * 3) SERVICE_ACCOUNT_PATH (chemin du fichier), sinon ./credentials/serviceAccount.json
 */
function initFirebase() {
  if (admin.apps.length) {
    app = admin.app();
    return app;
  }

  // 1) ADC via GOOGLE_APPLICATION_CREDENTIALS si présent
  try {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      app = admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
      return app;
    }
  } catch (_) {}

  // 2) JSON inline via env
  if (process.env.SERVICE_ACCOUNT_JSON) {
    const json = JSON.parse(process.env.SERVICE_ACCOUNT_JSON);
    app = admin.initializeApp({
      credential: admin.credential.cert(json),
    });
    return app;
  }

  // 3) Fichier sur disque
  const serviceAccountPath =
    process.env.SERVICE_ACCOUNT_PATH || './credentials/serviceAccount.json';
  const absolute = resolve(process.cwd(), serviceAccountPath);
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const serviceAccount = require(absolute);

  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  return app;
}

function auth() {
  if (!app) initFirebase();
  return admin.auth(app);
}

function db() {
  if (!app) initFirebase();
  return admin.firestore(app);
}

function messaging() {
  if (!app) initFirebase();
  return admin.messaging(app);
}

module.exports = { initFirebase, auth, db, messaging, admin };
