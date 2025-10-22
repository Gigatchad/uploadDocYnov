// controllers/requestsController.js
const { db } = require('../firebase');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const {
  addNotification,
  getTokensForRoles,
  getTokensForUids,
  sendFCM,
} = require('../services/notifications');

// ⚠️ Assure la config cloudinary (services/cloudinary appelle cloudinary.config(...))
require('../services/cloudinary');
const cloudinary = require('cloudinary').v2;

const REQUESTS_COLLECTION = 'requests';

// ------- Utils -------
function tsToDate(ts) {
  if (!ts) return new Date(0);
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (typeof ts === 'number' || typeof ts === 'string') return new Date(ts);
  if (ts?._seconds) return new Date(ts._seconds * 1000);
  if (ts?.seconds) return new Date(ts.seconds * 1000);
  return new Date(0);
}
function withId(doc) {
  return { id: doc.id, ...doc.data() };
}

// =======================================================
// GET /api/requests?scope=admin|mine&status=&limit=100
// - Admin/Personnel (scope != 'mine') : (MODIFIÉ) → seulement approved + sent
// - Étudiant/Parent (ou scope=mine)   : uniquement les siennes
//    - requestedByUid = uid
//    - requestedForUid = uid
//    - parentUid = uid (si parent)
// Notes Firestore : pas d’OR → on fait plusieurs requêtes et on fusionne côté serveur.
// =======================================================
async function listRequests(req, res) {
  const firestore = db();
  const role = req.user.role; // 'admin' | 'personnel' | 'etudiant' | 'parent'
  const uid = req.user.uid;
  const scope = String(req.query.scope || '').toLowerCase(); // 'admin' | 'mine' | ''
  const status = String(req.query.status || '').toLowerCase(); // 'pending' | 'in_progress' | 'approved' | 'rejected' | ''
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 200);

  const coll = firestore.collection(REQUESTS_COLLECTION);

  // ------ STAFF : admin/personnel → (MODIF) seulement approved + sent ------
  if (['admin', 'personnel'].includes(role) && scope !== 'mine') {
    // ⚠️ Requiert un index composite: (status ASC, createdAt DESC) sur 'requests'
    const snap = await coll
      .where('status', 'in', ['approved', 'sent'])
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    const items = snap.docs.map(withId);
    return res.json({ items });
  }

  // ------ MINE : étudiant/parent (ou staff ayant demandé son propre feed) ------
  // Construire plusieurs requêtes puis fusionner
  const queries = [];

  // 1) demandes créées par moi
  queries.push(
    (status ? coll.where('status', '==', status) : coll)
      .where('requestedByUid', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(limit)
  );

  // 2) demandes pour moi (étudiant)
  queries.push(
    (status ? coll.where('status', '==', status) : coll)
      .where('requestedForUid', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(limit)
  );

  // 3) si je suis parent → demandes liées à moi en tant que parent
  if (role === 'parent') {
    queries.push(
      (status ? coll.where('status', '==', status) : coll)
        .where('parentUid', '==', uid)
        .orderBy('createdAt', 'desc')
        .limit(limit)
    );
  }

  // Exécuter toutes les requêtes et fusionner par id unique
  const [s1, s2, s3] = await Promise.all(queries.map((q) => q.get()));
  const map = new Map();

  for (const s of [s1, s2, s3].filter(Boolean)) {
    s.forEach((doc) => map.set(doc.id, withId(doc)));
  }

  // Tri final (desc) et coupe à "limit"
  const items = Array.from(map.values())
    .sort((a, b) => tsToDate(b.createdAt) - tsToDate(a.createdAt))
    .slice(0, limit);

  return res.json({ items });
}

// =======================================================
// POST /api/requests
// (identique à ta version précédente)
// =======================================================
async function createRequest(req, res) {
  const firestore = db();
  const actorUid = req.user.uid;
  const actorRole = req.user.role;

  const {
    type = null,              // string libre
    studentUid: studentUidRaw, // requis si parent
    notes = '',
    deliveryMethod = null,
    targetEmail = null,
    attachments = [],
  } = req.body || {};

  if (!['etudiant', 'parent'].includes(actorRole)) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

  const actorSnap = await firestore.collection('users').doc(actorUid).get();
  if (!actorSnap.exists) return res.status(401).json({ error: 'USER_NOT_FOUND' });
  const actor = actorSnap.data() || {};

  // qui est l’étudiant concerné ?
  let requestedForUid = actorUid;
  let parentUid = null;
  if (actorRole === 'parent') {
    if (!studentUidRaw) return res.status(400).json({ error: 'STUDENT_UID_REQUIRED' });
    const children = Array.isArray(actor.parentOf) ? actor.parentOf : [];
    if (!children.includes(String(studentUidRaw))) {
      return res.status(403).json({ error: 'NOT_CHILD_OF_PARENT' });
    }
    requestedForUid = String(studentUidRaw);
    parentUid = actorUid;
  }

  const studentSnap = await firestore.collection('users').doc(requestedForUid).get();
  if (!studentSnap.exists) return res.status(400).json({ error: 'STUDENT_NOT_FOUND' });
  const student = studentSnap.data() || {};

  const requestedFor = {
    prenom: student.prenom || null,
    nom: student.nom || null,
    displayName:
      student.displayName ||
      [student.prenom, student.nom].filter(Boolean).join(' ') ||
      null,
    filiere: student.filiere || null,
    niveau: student.niveau || null,
    email: student.email || null,
  };

  const requestedBy = {
    prenom: actor.prenom || null,
    nom: actor.nom || null,
    email: actor.email || null,
  };

  let destEmail = targetEmail || null;
  if (!destEmail && deliveryMethod?.toLowerCase() === 'email') {
    destEmail = student.notifyEmail || student.email || actor.email || null;
  }

  const now = FieldValue.serverTimestamp();
  const ref = firestore.collection(REQUESTS_COLLECTION).doc();

  const doc = {
    type: type || null,
    status: 'pending',

    requestedForUid,
    requestedFor,

    requestedByUid: actorUid,
    requestedByRole: actorRole,
    requestedBy,

    parentUid: parentUid || null,

    notes: notes || '',
    deliveryMethod: deliveryMethod || null,
    targetEmail: destEmail,

    attachments: Array.isArray(attachments) ? attachments.slice(0, 6) : [],

    assignedToUid: null,
    assignedToName: null,

    createdAt: now,
    updatedAt: now,
  };

  await firestore.runTransaction(async (tx) => {
    tx.set(ref, doc);
    tx.set(ref.collection('events').doc(), {
      type: 'submitted',
      comment: 'Demande soumise',
      byUid: actorUid,
      byRole: actorRole,
      at: now,
    });
  });

  const requestedForName =
    requestedFor.displayName ||
    [requestedFor.prenom, requestedFor.nom].filter(Boolean).join(' ') ||
    'Étudiant';

  // Notif persistée + FCM pour ADMIN/PERSONNEL
  await addNotification({
    kind: 'request_submitted',
    requestId: ref.id,
    status: 'pending',
    type,
    notes,

    requestedBy: {
      uid: actorUid,
      name:
        actor.displayName ||
        [actor.prenom, actor.nom].filter(Boolean).join(' ') ||
        actor.email ||
        '—',
      role: actorRole,
    },
    requestedFor: {
      uid: requestedForUid,
      name: requestedForName,
      filiere: requestedFor.filiere || null,
      niveau: requestedFor.niveau || null,
    },

    recipients: ['role:admin', 'role:personnel'],
  });

  try {
    const tokens = await getTokensForRoles(['admin', 'personnel']);
    await sendFCM(tokens, {
      title: `Nouvelle demande${type ? ` – ${type}` : ''}`,
      body: `${requestedForName} • statut: pending`,
      data: { requestId: ref.id, event: 'request_submitted' },
    });
  } catch (e) {
    console.warn('[FCM submit] error:', e.message);
  }

  return res.json({ ok: true, id: ref.id, status: 'pending' });
}

// =======================================================
// PATCH /api/requests/:id/status
// =======================================================
async function updateRequestStatus(req, res) {
  const firestore = db();
  const { id } = req.params;
  const { status, rejectionReason = '' } = req.body || {};
  const actorUid = req.user.uid;
  const actorRole = req.user.role;

  if (!['admin', 'personnel'].includes(actorRole)) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'INVALID_STATUS' });
  }

  const ref = firestore.collection(REQUESTS_COLLECTION).doc(id);
  const now = FieldValue.serverTimestamp();

  // 1) Transaction: update request + event
  let reqDoc;
  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('REQUEST_NOT_FOUND');
    reqDoc = snap.data();

    const patch = { status, updatedAt: now };
    if (status === 'approved') patch.approvedAt = now;
    if (status === 'rejected') {
      patch.rejectedAt = now;
      patch.rejectionReason = String(rejectionReason || '');
    }

    tx.update(ref, patch);

    tx.set(ref.collection('events').doc(), {
      type: status,
      comment: status === 'approved' ? 'Demande approuvée' : (rejectionReason || 'Rejet'),
      byUid: actorUid,
      byRole: actorRole,
      at: now,
    });
  }).catch((e) => {
    if (e.message === 'REQUEST_NOT_FOUND') {
      return res.status(404).json({ error: 'REQUEST_NOT_FOUND' });
    }
    console.error('[updateRequestStatus][tx] error:', e);
    return res.status(500).json({ error: 'TX_FAILED' });
  });
  if (res.headersSent) return;

  // 2) Notifs destinataires (demandeur + étudiant si parent)
  const reqFor = reqDoc.requestedFor || {};
  const reqForName =
    reqFor.displayName ||
    [reqFor.prenom, reqFor.nom].filter(Boolean).join(' ') ||
    'Étudiant';

  const reqBy = reqDoc.requestedBy || {};
  const reqByName =
    reqBy.displayName ||
    [reqBy.prenom, reqBy.nom].filter(Boolean).join(' ') ||
    reqBy.email ||
    '—';

  const recipients = [`uid:${reqDoc.requestedByUid}`];
  if (reqDoc.requestedByRole === 'parent' && reqDoc.requestedForUid) {
    recipients.push(`uid:${reqDoc.requestedForUid}`);
  }

  await addNotification({
    kind: status === 'approved' ? 'request_approved' : 'request_rejected',
    requestId: id,
    status,
    type: reqDoc.type || null,
    notes: reqDoc.notes || null,

    requestedBy: {
      uid: reqDoc.requestedByUid,
      name: reqByName,
      role: reqDoc.requestedByRole,
    },
    requestedFor: {
      uid: reqDoc.requestedForUid,
      name: reqForName,
      filiere: reqFor.filiere || null,
      niveau: reqFor.niveau || null,
    },

    approvedAt: status === 'approved' ? new Date() : null,
    rejectedAt: status === 'rejected' ? new Date() : null,
    rejectionReason: status === 'rejected' ? String(rejectionReason || '') : null,

    recipients,
  });

  // 3) FCM
  try {
    const uids = [reqDoc.requestedByUid];
    if (reqDoc.requestedByRole === 'parent' && reqDoc.requestedForUid) {
      uids.push(reqDoc.requestedForUid);
    }
    const tokens = await getTokensForUids(uids);
    const title =
      status === 'approved'
        ? `Demande approuvée – ${reqDoc.type || ''}`
        : `Demande rejetée – ${reqDoc.type || ''}`;
    const body =
      status === 'approved'
        ? `Votre demande pour ${reqForName} a été approuvée`
        : `Votre demande pour ${reqForName} a été rejetée${
            rejectionReason ? `: ${rejectionReason}` : ''
          }`;
    await sendFCM(tokens, {
      title,
      body,
      data: { requestId: id, event: status },
    });
  } catch (e) {
    console.warn('[FCM status] error:', e.message);
  }

  // 4) Synchronise les notifs staff “request_submitted”
  try {
    const notifRef = firestore.collection('notifications');
    const q = await notifRef
      .where('requestId', '==', id)
      .where('kind', '==', 'request_submitted')
      .get();

    if (!q.empty) {
      const batch = firestore.batch();
      q.forEach((doc) => {
        batch.update(doc.ref, { status, updatedAt: FieldValue.serverTimestamp() });
      });
      await batch.commit();
    }
  } catch (e) {
    console.warn('[sync staff notifications] error:', e.message);
  }

  res.json({ ok: true, id, status });
}

// =======================================================
// (Optionnel) PATCH /api/requests/:id/document  { notes? }
// → émettre la notif "document_sent" aux destinataires
// =======================================================
async function notifyDocumentSent(req, res) {
  const firestore = db();
  const { id } = req.params;
  const { notes = '' } = req.body || {};
  const actorRole = req.user.role;

  if (!['admin', 'personnel'].includes(actorRole)) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

  const ref = firestore.collection(REQUESTS_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'REQUEST_NOT_FOUND' });
  const r = snap.data();

  const now = FieldValue.serverTimestamp();
  await ref.collection('events').add({
    type: 'document_sent',
    comment: notes || 'Document envoyé',
    byUid: req.user.uid,
    byRole: actorRole,
    at: now,
  });

  const reqFor = r.requestedFor || {};
  const reqForName =
    reqFor.displayName ||
    [reqFor.prenom, reqFor.nom].filter(Boolean).join(' ') ||
    'Étudiant';
  const reqBy = r.requestedBy || {};
  const reqByName =
    reqBy.displayName ||
    [reqBy.prenom, reqBy.nom].filter(Boolean).join(' ') ||
    reqBy.email ||
    '—';

  const recipients = [`uid:${r.requestedByUid}`];
  if (r.requestedByRole === 'parent' && r.requestedForUid) {
    recipients.push(`uid:${r.requestedForUid}`);
  }

  await addNotification({
    kind: 'document_sent',
    requestId: id,
    status: r.status || null,
    type: r.type || null,
    notes: String(notes || ''),
    requestedBy: { uid: r.requestedByUid, name: reqByName, role: r.requestedByRole },
    requestedFor: {
      uid: r.requestedForUid,
      name: reqForName,
      filiere: reqFor.filiere || null,
      niveau: reqFor.niveau || null,
    },
    recipients,
  });

  try {
    const uids = [r.requestedByUid];
    if (r.requestedByRole === 'parent' && r.requestedForUid) uids.push(r.requestedForUid);
    const tokens = await getTokensForUids(uids);
    await sendFCM(tokens, {
      title: `Document envoyé – ${r.type || ''}`,
      body: `${reqForName}: ${notes || 'Un document a été déposé'}`,
      data: { requestId: id, event: 'document_sent' },
    });
  } catch (e) {
    console.warn('[FCM document_sent] error:', e.message);
  }

  res.json({ ok: true });
}

// =======================================================
// POST /api/requests/:id/upload  (multipart/form-data)
// fields:
//   - file: (required) le fichier à uploader
//   - notes?: string
//   - notify?: boolean (si true => passe la demande en "sent" + notifs)
// =======================================================
function uploadBufferToCloudinary(buffer, filename, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'raw',
        folder: folder || process.env.CLOUDINARY_UPLOAD_FOLDER || 'myc-docs',
        use_filename: true,
        unique_filename: true,
        overwrite: false,
        filename_override: filename || undefined,
      },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    stream.end(buffer);
  });
}

async function uploadRequestDocument(req, res) {
  const firestore = db();
  const { id } = req.params;
  const actorUid = req.user.uid;
  const actorRole = req.user.role;

  if (!['admin', 'personnel'].includes(actorRole)) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

  try {
    const file = req.file; // fourni par multer.memoryStorage
    const { notes = '', notify = true } = req.body || {};

    if (!file || !file.buffer) {
      return res.status(400).json({ error: 'FILE_REQUIRED' });
    }

    // Upload Cloudinary depuis le buffer
    const result = await uploadBufferToCloudinary(
      file.buffer,
      file.originalname,
      process.env.CLOUDINARY_UPLOAD_FOLDER || 'myc-docs'
    );

    const publicId = result.public_id;
    const secureUrl = result.secure_url;
    const mimeType = file.mimetype || 'application/octet-stream';
    const originalFilename = file.originalname || 'document';

    const ref = firestore.collection(REQUESTS_COLLECTION).doc(id);
    const now = FieldValue.serverTimestamp();

    // ⚠️ PAS de serverTimestamp() dans un array
    const newAttachment = {
      publicId,
      secureUrl,
      mimeType,
      originalFilename,
      uploadedByUid: actorUid,
      uploadedAt: Timestamp.now(), // OK dans un array
    };

    // Transaction: merge attachments + (optionnel) passer en 'sent'
    await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('REQUEST_NOT_FOUND');
      const r = snap.data() || {};

      const prev = Array.isArray(r.attachments) ? r.attachments : [];
      const merged = [...prev, newAttachment];

      const patch = {
        attachments: merged,
        documentUrl: secureUrl,
        updatedAt: now,
      };

      const willNotify = (String(notify).toLowerCase() === 'true' || notify === true);
      if (willNotify) {
        patch.status = 'sent';
        patch.sentAt = now;
      }

      tx.update(ref, patch);

      tx.set(ref.collection('events').doc(), {
        type: willNotify ? 'document_sent' : 'document_uploaded',
        comment: notes || (willNotify ? 'Document envoyé' : 'Document téléversé'),
        byUid: actorUid,
        byRole: actorRole,
        at: now,
      });
    });

    // Envoi des notifications si notify=true
    const willNotify = (String(notify).toLowerCase() === 'true' || notify === true);
    if (willNotify) {
      const snap2 = await ref.get();
      const r2 = snap2.data() || {};

      const reqFor = r2.requestedFor || {};
      const reqForName =
        reqFor.displayName ||
        [reqFor.prenom, reqFor.nom].filter(Boolean).join(' ') ||
        'Étudiant';

      const reqBy = r2.requestedBy || {};
      const reqByName =
        reqBy.displayName ||
        [reqBy.prenom, reqBy.nom].filter(Boolean).join(' ') ||
        reqBy.email ||
        '—';

      const recipients = [`uid:${r2.requestedByUid}`];
      if (r2.requestedByRole === 'parent' && r2.requestedForUid) {
        recipients.push(`uid:${r2.requestedForUid}`);
      }

      await addNotification({
        kind: 'document_sent',
        requestId: id,
        status: 'sent',
        type: r2.type || null,
        notes: String(notes || ''),
        requestedBy: { uid: r2.requestedByUid, name: reqByName, role: r2.requestedByRole },
        requestedFor: {
          uid: r2.requestedForUid,
          name: reqForName,
          filiere: reqFor.filiere || null,
          niveau: reqFor.niveau || null,
        },
        recipients,
      });

      try {
        const uids = [r2.requestedByUid];
        if (r2.requestedByRole === 'parent' && r2.requestedForUid) uids.push(r2.requestedForUid);
        const tokens = await getTokensForUids(uids);
        await sendFCM(tokens, {
          title: `Document envoyé – ${r2.type || ''}`,
          body: `${reqForName}: ${notes || 'Un document est disponible au téléchargement.'}`,
          data: { requestId: id, event: 'document_sent' },
        });
      } catch (e) {
        console.warn('[FCM document_sent] error:', e.message);
      }
    }

    return res.json({
      ok: true,
      id,
      status: willNotify ? 'sent' : undefined,
      attachment: { publicId, secureUrl, mimeType, originalFilename },
    });
  } catch (e) {
    console.error('[uploadRequestDocument] error:', e);
    return res.status(500).json({ error: 'UPLOAD_FAILED' });
  }
}
// --- AJOUT : GET /api/requests/:id/download ---
async function getRequestDownload(req, res) {
  const firestore = db();
  const { id } = req.params;
  const role = req.user.role;
  const uid  = req.user.uid;

  // 1) lire la demande
  const ref = firestore.collection(REQUESTS_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'REQUEST_NOT_FOUND' });
  const r = snap.data() || {};

  // 2) autorisations de lecture du fichier
  //    - admin/personnel : OK
  //    - étudiant/parent : seulement s’il s’agit de leur demande
  const isOwner =
    r.requestedByUid === uid ||
    r.requestedForUid === uid ||
    r.parentUid === uid;

  if (!['admin', 'personnel'].includes(role) && !isOwner) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

  // 3) trouver l’URL à renvoyer (préférence = fichier "envoyé")
  let url = null;
  let filename = null;

  // a) livrés via /upload → deliveredAttachments[]
  if (Array.isArray(r.deliveredAttachments) && r.deliveredAttachments.length > 0) {
    const last = r.deliveredAttachments[r.deliveredAttachments.length - 1];
    url = last.secureUrl || last.url || null;
    filename =
      last.originalFilename ||
      (last.publicId ? String(last.publicId).split('/').pop() : null);
  }

  // b) fallback simple si tu as un champ direct
  if (!url && r.documentUrl) {
    url = r.documentUrl;
  }

  // c) (facultatif) dernier recours : le premier attachments[] si tu veux autoriser ça
  if (!url && Array.isArray(r.attachments) && r.attachments.length > 0) {
    const a = r.attachments[0];
    url = a.secureUrl || a.url || null;
    filename =
      a.originalFilename ||
      (a.publicId ? String(a.publicId).split('/').pop() : null);
  }

  if (!url) return res.status(404).json({ error: 'FILE_NOT_FOUND' });

  // Optionnel: imposer status 'sent' si tu veux ne télécharger que ce qui a été envoyé
  // if (r.status !== 'sent') return res.status(409).json({ error: 'NOT_SENT_YET' });

  return res.json({
    ok: true,
    url,
    filename: filename || `${(r.type || 'document').replace(/\s+/g, '_')}.pdf`,
  });
}
async function listMySentDocuments(req, res) {
  // Forcer les query params comme si l'utilisateur appelait /requests?scope=mine&status=sent
  req.query = {
    ...req.query,
    scope: 'mine',
    status: 'sent',
  };
  return listRequests(req, res);
}


module.exports = {
  listRequests,
  createRequest,
  updateRequestStatus,
  notifyDocumentSent,
  uploadRequestDocument, // ⬅️ nouvel export
  getRequestDownload,
  listMySentDocuments,
};
