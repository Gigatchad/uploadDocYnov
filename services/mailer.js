// services/mailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE || 'false') === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

function projectName() {
  return process.env.PROJECT_NAME || 'Accès Ynov';
}
const MAIL_FROM = process.env.MAIL_FROM || 'Ynov <no-reply@example.com>';

/**
 * Envoie un email très simple avec :
 *  - loginEmail (identifiant de connexion)
 *  - resetLink  (lien pour définir le mot de passe)
 * -> à l'email personnel
 */
async function sendAccessEmail(to, { loginEmail, resetLink }) {
  const subject = `Accès au portail — ${projectName()}`;

  const text =
`Bonjour,

Votre accès au portail ${projectName()} a été créé.

Identifiant de connexion : ${loginEmail}
Définir le mot de passe : ${resetLink}

Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.

Cordialement,
${projectName()}`;

  const html =
`<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.55">
  <p>Bonjour,</p>
  <p>Votre accès au portail <strong>${escapeHtml(projectName())}</strong> a été créé.</p>
  <p><strong>Identifiant de connexion :</strong> ${escapeHtml(loginEmail || '')}</p>
  <p><a href="${resetLink}" target="_blank"
        style="display:inline-block;padding:10px 14px;border-radius:8px;background:#17766E;color:#fff;text-decoration:none;">
        Définir mon mot de passe
     </a></p>
  <p style="margin-top:10px;">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
  <p>Cordialement,<br/>${escapeHtml(projectName())}</p>
</div>`;

  return transporter.sendMail({ from: MAIL_FROM, to, subject, text, html });
}

/** Alerte sécurité : changement de login email (envoyée à l'email personnel) */
async function sendLoginEmailChangedNotice(to, { displayName, oldLoginEmail, newLoginEmail }) {
  const subject = `[Sécurité] Changement d'email de connexion — ${projectName()}`;

  const text =
`Bonjour ${displayName || ''},

Votre email de connexion a été modifié.

Ancien : ${oldLoginEmail}
Nouveau : ${newLoginEmail}

Si vous n'êtes pas à l'origine de ce changement, contactez immédiatement l'administration.

— ${projectName()}`;

  const html =
`<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.55">
  <p>Bonjour ${escapeHtml(displayName || '')},</p>
  <p>Votre <strong>email de connexion</strong> a été modifié.</p>
  <p>Ancien : <code>${escapeHtml(oldLoginEmail || '')}</code><br/>
     Nouveau : <code>${escapeHtml(newLoginEmail || '')}</code></p>
  <p style="color:#b91c1c">Si vous n'êtes pas à l'origine de ce changement, contactez immédiatement l'administration.</p>
  <p>— ${escapeHtml(projectName())}</p>
</div>`;

  return transporter.sendMail({ from: MAIL_FROM, to, subject, text, html });
}

/** Information : l'email personnel de notification a changé (envoyée au NOUVEL email personnel) */
async function sendNotifyEmailChangedNotice(to, { displayName, newNotifyEmail }) {
  const subject = `[Information] Adresse de notification mise à jour — ${projectName()}`;

  const text =
`Bonjour ${displayName || ''},

Votre adresse de réception des notifications a été mise à jour :
${newNotifyEmail}

Vous recevrez désormais toutes les notifications sur cet email.

— ${projectName()}`;

  const html =
`<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.55">
  <p>Bonjour ${escapeHtml(displayName || '')},</p>
  <p>Votre adresse de réception des notifications a été mise à jour :</p>
  <p><strong>${escapeHtml(newNotifyEmail || '')}</strong></p>
  <p>Vous recevrez désormais toutes les notifications sur cet email.</p>
  <p>— ${escapeHtml(projectName())}</p>
</div>`;

  return transporter.sendMail({ from: MAIL_FROM, to, subject, text, html });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

module.exports = {
  sendAccessEmail,
  sendLoginEmailChangedNotice,
  sendNotifyEmailChangedNotice,
  projectName
};
