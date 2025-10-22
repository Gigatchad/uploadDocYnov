// controllers/cloudinaryController.js
const { getSignedUploadParams, destroyAsset } = require('../services/cloudinary');

// auditLog est optionnel — s'il n'existe pas dans ton projet, tu peux enlever les lignes avec auditLog
let auditLog = null;
try { ({ auditLog } = require('../services/audit')); } catch (_) {}

/** POST /api/cloudinary/signature (auth requis) */
async function getSignature(req, res) {
  try {
    // 👉 Si tu veux restreindre par rôle, décommente :
    // if (!['admin', 'personnel'].includes(req.user.role)) {
    //   return res.status(403).json({ error: 'FORBIDDEN' });
    // }

    const data = getSignedUploadParams();
    auditLog?.(req, 'CLOUDINARY_GET_SIGNATURE', { collection: 'cloudinary', id: req.user.uid }, { folder: data.folder }).catch(() => {});
    return res.json(data);
  } catch (e) {
    console.error('[cloudinary.signature]', e);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
}

/** DELETE /api/cloudinary/asset (auth requis, optionnel) */
async function deleteAsset(req, res) {
  try {
    // restriction stricte recommandée pour supprimer
    if (!['admin', 'personnel'].includes(req.user.role)) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    const { publicId, resourceType = 'image' } = req.body || {};
    if (!publicId) return res.status(400).json({ error: 'PUBLIC_ID_REQUIRED' });

    const out = await destroyAsset(publicId, resourceType);
    auditLog?.(req, 'CLOUDINARY_DELETE_ASSET', { collection: 'cloudinary', id: publicId }, { out }).catch(() => {});
    return res.json({ ok: true, result: out });
  } catch (e) {
    console.error('[cloudinary.delete]', e);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
}

module.exports = { getSignature, deleteAsset };
