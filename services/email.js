// services/email.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE || 'false') === 'true', // true si 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendResetCodeEmail(to, code, ttlMin = 10) {
  const from = process.env.MAIL_FROM || 'no-reply@yourapp.com';
  const subject = 'Votre code de réinitialisation';
  const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:16px;color:#0f172a">
      <p>Bonjour,</p>
      <p>Voici votre code de réinitialisation :</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:2px;">${code}</p>
      <p>Ce code est valable <strong>${ttlMin} minutes</strong>.</p>
      <p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.</p>
    </div>
  `;
  await transporter.sendMail({ from, to, subject, html });
}

module.exports = { sendResetCodeEmail };
