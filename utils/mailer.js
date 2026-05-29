// Email via Resend (https://resend.com) — free tier: 3,000 emails/month
async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { console.warn('RESEND_API_KEY not set — email not sent'); return false; }
  const fromName = process.env.APP_NAME || 'GigTrack Pro';
  const fromAddr = process.env.FROM_EMAIL || 'noreply@gigtrackpro.app';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromName + ' <' + fromAddr + '>', to, subject, html }),
    });
    const data = await r.json();
    if (!r.ok) { console.error('Resend error:', data); return false; }
    return true;
  } catch (err) { console.error('Email send error:', err.message); return false; }
}

function otpEmailHTML(code, appName) {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
      <h2 style="color:#1e40af">${appName || 'GigTrack Pro'}</h2>
      <p>Your login verification code is:</p>
      <div style="font-size:40px;font-weight:900;letter-spacing:10px;color:#1e40af;padding:20px 0">${code}</div>
      <p style="color:#64748b;font-size:14px">This code expires in 10 minutes. Do not share it with anyone.</p>
    </div>`;
}

module.exports = { sendEmail, otpEmailHTML };
