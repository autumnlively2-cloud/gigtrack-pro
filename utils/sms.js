// SMS via Twilio
async function sendSMS(to, body) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber) {
    console.warn('Twilio not configured — SMS not sent');
    return false;
  }
  try {
    const url  = 'https://api.twilio.com/2010-04-01/Accounts/' + accountSid + '/Messages.json';
    const body2 = new URLSearchParams({ To: to, From: fromNumber, Body: body }).toString();
    const creds = Buffer.from(accountSid + ':' + authToken).toString('base64');
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Basic ' + creds, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body2,
    });
    const data = await r.json();
    if (!r.ok) { console.error('Twilio error:', data.message); return false; }
    return true;
  } catch (err) { console.error('SMS send error:', err.message); return false; }
}

module.exports = { sendSMS };
