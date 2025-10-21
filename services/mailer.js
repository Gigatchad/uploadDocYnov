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

/**
 * Envoie un email très simple avec seulement:
 *  - loginEmail (identifiant de connexion)
 *  - resetLink  (lien pour définir le mot de passe)
 *
 * @param {string} to           destinataire (email personnel)
 * @param {object} ctx          { loginEmail, resetLink }
 */
async function sendAccessEmail(to, { loginEmail, resetLink }) {
  const from = process.env.MAIL_FROM || 'Ynov <no-reply@example.com>';
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

  return transporter.sendMail({ from, to, subject, text, html });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

module.exports = { sendAccessEmail, projectName };
