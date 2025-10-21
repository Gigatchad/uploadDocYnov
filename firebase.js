// firebase.js
const admin = require('firebase-admin');
const { resolve } = require('path');

let app;

function initFirebase() {
  if (admin.apps.length) {
    app = admin.app();
    return;
  }
  const serviceAccountPath = process.env.SERVICE_ACCOUNT_PATH || './credentials/serviceAccount.json';
  const absolute = resolve(process.cwd(), serviceAccountPath);

  // charge le JSON du service account depuis le disque
  const serviceAccount = require(absolute);

  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

function auth() {
  if (!app) initFirebase();
  return admin.auth(app);
}

function db() {
  if (!app) initFirebase();
  return admin.firestore(app);
}

module.exports = { initFirebase, auth, db };
