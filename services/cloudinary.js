// services/cloudinary.js
const cloudinary = require('cloudinary').v2;

const CLOUD_NAME   = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY      = process.env.CLOUDINARY_API_KEY;
const API_SECRET   = process.env.CLOUDINARY_API_SECRET;

const UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET || 'myc_signed';
const UPLOAD_FOLDER = process.env.CLOUDINARY_UPLOAD_FOLDER || 'myc-docs';

cloudinary.config({
  cloud_name: CLOUD_NAME,
  api_key: API_KEY,
  api_secret: API_SECRET,
  secure: true,
});

/**
 * Génère les params signés nécessaires à un upload côté front.
 * On NE signe que: timestamp, folder, upload_preset.
 */
function getSignedUploadParams() {
  const timestamp = Math.floor(Date.now() / 1000);

  const paramsToSign = {
    timestamp,
    folder: UPLOAD_FOLDER,
    upload_preset: UPLOAD_PRESET,
  };

  const signature = cloudinary.utils.api_sign_request(paramsToSign, API_SECRET);

  return {
    ok: true,
    cloudName: CLOUD_NAME,
    apiKey: API_KEY,
    timestamp,
    signature,
    folder: UPLOAD_FOLDER,
    upload_preset: UPLOAD_PRESET,
    // https://api.cloudinary.com/v1_1/<cloudName>/<resource_type>/upload
  };
}

/** (optionnel) suppression d’un asset côté serveur */
async function destroyAsset(publicId, resourceType = 'image') {
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
}

/** ⬇️⬇️ AJOUT : upload d’un Buffer en resource_type=raw (PDF/DOC/DOCX) */
function uploadBufferRaw(buffer, { folder = UPLOAD_FOLDER, filename } = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'raw',
        folder,
        use_filename: true,
        filename_override: filename, // on garde le nom original quand possible
        unique_filename: true,
        overwrite: false,
      },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

module.exports = {
  getSignedUploadParams,
  destroyAsset,
  uploadBufferRaw,     // ⬅️ export du helper
};
