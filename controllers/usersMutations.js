// controllers/usersMutations.js
const { auth, db } = require('../firebase');
const { FieldValue } = require('firebase-admin/firestore');
const { auditLog } = require('../services/audit');
const {
  sendLoginEmailChangedNotice,
  sendNotifyEmailChangedNotice,
} = require('../services/mailer');

// Rappel: le rôle est IMMUTABLE ici. Pour changer de rôle: supprimer puis recréer.

async function updateUser(req, res) {
  const a = auth();
  const firestore = db();

  const uid = req.params.uid;
  const {
    email,        // login @école (Firebase Auth + Firestore)
    notifyEmail,  // email personnel (réception des emails)
    prenom,
    nom,
    filiere,
    niveau,
    parentOf      // si role = parent (liste d'UIDs étudiants)
  } = req.body || {};

  // 1) charger l'existant
  const userRef = firestore.collection('users').doc(uid);
  const snap = await userRef.get();
  if (!snap.exists) return res.status(404).json({ error: 'USER_NOT_FOUND' });

  const before = snap.data();
  const role = before.role;

  const prevLoginEmail  = before.email || null;
  const prevNotifyEmail = before.notifyEmail || null;

  // 2) collision login email ?
  if (email && email !== prevLoginEmail) {
    try {
      const existing = await a.getUserByEmail(email);
      if (existing && existing.uid !== uid) {
        return res.status(409).json({ error: 'EMAIL_ALREADY_USED' });
      }
    } catch (e) {
      if (e.code !== 'auth/user-not-found') throw e;
    }
  }

  // 3) Mise à jour Auth (login email / displayName)
  const nextPrenom = typeof prenom !== 'undefined' ? prenom : before.prenom;
  const nextNom    = typeof nom    !== 'undefined' ? nom    : before.nom;
  const nextDisplayName = buildDisplayName(nextPrenom, nextNom);

  const authUpdates = {};
  if (email && email !== prevLoginEmail) authUpdates.email = email;
  if (nextDisplayName !== before.displayName) authUpdates.displayName = nextDisplayName || null;

  if (Object.keys(authUpdates).length) {
    try {
      await a.updateUser(uid, authUpdates);
    } catch (e) {
      return res.status(400).json({ error: 'AUTH_UPDATE_FAILED', details: e.message });
    }
  }

  // 4) Si parentOf fourni et role=parent → exclusivité 1 parent / étudiant
  if (Array.isArray(parentOf)) {
    if (role !== 'parent') {
      return res.status(400).json({ error: 'PARENT_OF_ONLY_FOR_PARENT_ROLE' });
    }

    // On fait toutes les lectures AVANT toutes les écritures
    await firestore.runTransaction(async (tx) => {
      const parentRef = firestore.collection('users').doc(uid);
      const parentSnap = await tx.get(parentRef);
      if (!parentSnap.exists) throw new Error('PARENT_DOC_NOT_FOUND');

      const prev = Array.isArray(parentSnap.data().parentOf) ? parentSnap.data().parentOf : [];
      const next = parentOf;

      // calcul des ensembles
      const toRemove = prev.filter(id => !next.includes(id));
      const toAdd    = next.filter(id => !prev.includes(id));

      // 4.1 LECTURES: charger tous les documents enfants à lire AVANT TOUTE ÉCRITURE
      const removeRefs = toRemove.map(id => firestore.collection('users').doc(id));
      const addRefs    = toAdd.map(id => firestore.collection('users').doc(id));

      const removeSnaps = await Promise.all(removeRefs.map(r => tx.get(r)));
      const addSnaps    = await Promise.all(addRefs.map(r => tx.get(r)));

      // 4.2 VALIDATIONS (toujours avant les writes)
      // validate remove list
      removeSnaps.forEach((s, i) => {
        if (!s.exists) return; // tolérant
        const data = s.data();
        if (data.role !== 'etudiant') {
          throw new Error(`UID ${removeRefs[i].id} n'est pas un etudiant`);
        }
        // pas besoin d'autre check pour remove
      });

      // validate add list
      addSnaps.forEach((s, i) => {
        if (!s.exists) throw new Error(`Etudiant ${addRefs[i].id} introuvable`);
        const data = s.data();
        if (data.role !== 'etudiant') {
          throw new Error(`UID ${addRefs[i].id} n'est pas un etudiant`);
        }
        if (data.parentUid && data.parentUid !== uid) {
          throw new Error(`Etudiant ${addRefs[i].id} déjà associé à un autre parent`);
        }
      });

      // 4.3 ÉCRITURES: détacher puis attacher
      // détacher
      removeRefs.forEach((r, i) => {
        const s = removeSnaps[i];
        if (s.exists && s.data().parentUid === uid) {
          tx.update(r, { parentUid: null, updatedAt: FieldValue.serverTimestamp() });
        }
      });

      // attacher
      addRefs.forEach((r) => {
        tx.update(r, { parentUid: uid, updatedAt: FieldValue.serverTimestamp() });
      });

      // mettre à jour le parent
      tx.update(parentRef, { parentOf: next, updatedAt: FieldValue.serverTimestamp() });
    });
  }

  // 5) Mise à jour Firestore (autres champs)
  const fsUpdates = { updatedAt: FieldValue.serverTimestamp() };
  if (typeof prenom      !== 'undefined') fsUpdates.prenom      = prenom || null;
  if (typeof nom         !== 'undefined') fsUpdates.nom         = nom || null;

  if (nextDisplayName !== before.displayName) {
    fsUpdates.displayName = nextDisplayName || null;
    fsUpdates.displayNameLower = (nextDisplayName || '').toLowerCase() || null;
  }

  if (typeof notifyEmail !== 'undefined') fsUpdates.notifyEmail = notifyEmail || null;
  if (typeof email       !== 'undefined') fsUpdates.email       = email || null;

  if (role === 'etudiant') {
    if (typeof filiere !== 'undefined') fsUpdates.filiere = filiere || null;
    if (typeof niveau  !== 'undefined') fsUpdates.niveau  = niveau  || null;
  }

  if (Object.keys(fsUpdates).length > 1) {
    await userRef.set(fsUpdates, { merge: true });
  }

  // 6) Notifications email de sécurité
  const afterSnap = await userRef.get();
  const after = afterSnap.data() || {};
  const nextLoginEmail  = after.email || null;
  const nextNotifyEmail = after.notifyEmail || null;

  // 6.1 login email modifié ?
  if (nextLoginEmail && prevLoginEmail && nextLoginEmail !== prevLoginEmail) {
    const primaryRecipient = prevNotifyEmail || nextNotifyEmail;
    if (primaryRecipient) {
      await safeSend(() =>
        sendLoginEmailChangedNotice(primaryRecipient, {
          displayName: after.displayName || nextLoginEmail,
          oldLoginEmail: prevLoginEmail,
          newLoginEmail: nextLoginEmail,
        })
      );
    }
    if (nextNotifyEmail && nextNotifyEmail !== prevNotifyEmail) {
      await safeSend(() =>
        sendLoginEmailChangedNotice(nextNotifyEmail, {
          displayName: after.displayName || nextLoginEmail,
          oldLoginEmail: prevLoginEmail,
          newLoginEmail: nextLoginEmail,
        })
      );
    }
  }

  // 6.2 email personnel modifié ?
  if (nextNotifyEmail && nextNotifyEmail !== prevNotifyEmail) {
    await safeSend(() =>
      sendNotifyEmailChangedNotice(nextNotifyEmail, {
        displayName: after.displayName || nextLoginEmail || '',
        newNotifyEmail: nextNotifyEmail,
      })
    );
  }

  // 7) Audit
  await auditLog(
    req,
    'USER_UPDATE',
    { collection: 'users', id: uid },
    pickChangedMeta(before, after, ['email','notifyEmail','prenom','nom','filiere','niveau','parentOf'])
  );

  return res.json({ ok: true });
}

async function deleteUser(req, res) {
  const a = auth();
  const firestore = db();
  const uid = req.params.uid;

  const ref = firestore.collection('users').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'USER_NOT_FOUND' });

  const user = snap.data();
  const role = user.role;

  // Étudiant rattaché → interdit
  if (role === 'etudiant' && user.parentUid) {
    return res.status(409).json({
      error: 'DETACH_REQUIRED',
      message: 'Cet étudiant est associé à un parent. Supprimez d’abord le parent (ou détachez l’étudiant).'
    });
  }

  if (role === 'parent') {
    // Important: faire toutes les lectures AVANT les writes
    await firestore.runTransaction(async (tx) => {
      const parentRef = ref;
      const parentSnap = await tx.get(parentRef);
      if (!parentSnap.exists) throw new Error('PARENT_DOC_NOT_FOUND');

      const children = Array.isArray(parentSnap.data().parentOf) ? parentSnap.data().parentOf : [];
      const childRefs = children.map(id => firestore.collection('users').doc(id));

      // LECTURES
      const childSnaps = await Promise.all(childRefs.map(r => tx.get(r)));

      // ÉCRITURES: détacher les enfants qui pointent sur ce parent
      childSnaps.forEach((s, i) => {
        if (!s.exists) return;
        const data = s.data();
        if (data.role === 'etudiant' && data.parentUid === uid) {
          tx.update(childRefs[i], { parentUid: null, updatedAt: FieldValue.serverTimestamp() });
        }
      });

      tx.delete(parentRef);
    });
  } else {
    // étudiant (sans parent) ou personnel
    await ref.delete();
  }

  // Auth
  try { await a.deleteUser(uid); } catch (_) {}

  await auditLog(req, 'USER_DELETE', { collection: 'users', id: uid }, { role, email: user.email || null });
  return res.status(204).end();
}

// utils
function buildDisplayName(prenom, nom) {
  const p = (prenom || '').trim();
  const n = (nom || '').trim();
  const d = [p, n].filter(Boolean).join(' ');
  return d || null;
}

function pickChangedMeta(before, after, keys) {
  const out = {};
  for (const k of keys) {
    const b = normalize(before[k]);
    const a = normalize(after[k]);
    if (!isEqual(b, a)) out[k] = a;
  }
  return out;
}
const normalize = (v) => (Array.isArray(v) ? [...v].sort() : v ?? null);
const isEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function safeSend(fn) { try { await fn(); } catch (_) {} }

module.exports = { updateUser, deleteUser };
