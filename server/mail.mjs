// Transactional email via Resend or SendGrid, using their REST API (no npm dependency).
//
// Configure with env vars:
//   EMAIL_PROVIDER = resend | sendgrid
//   EMAIL_API_KEY  = your provider API key
//   EMAIL_FROM     = a verified sender, e.g. "CMS <no-reply@yourdomain.com>"
// When unset, email is skipped (the app still works; submissions are just not emailed).

const PROVIDER = (process.env.EMAIL_PROVIDER ?? '').toLowerCase();
const API_KEY = process.env.EMAIL_API_KEY ?? '';
const FROM = process.env.EMAIL_FROM ?? '';

export function emailConfigured() {
  return !!(PROVIDER && API_KEY && FROM);
}

/** Sends a plain-text email. Resolves { skipped } when email isn't configured. */
export async function sendEmail({ to, subject, text }) {
  if (!emailConfigured()) return { skipped: true };

  if (PROVIDER === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, text }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
    return { ok: true };
  }

  if (PROVIDER === 'sendgrid') {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: FROM },
        subject,
        content: [{ type: 'text/plain', value: text }],
      }),
    });
    if (!res.ok && res.status !== 202) throw new Error(`SendGrid ${res.status}: ${await res.text()}`);
    return { ok: true };
  }

  throw new Error(`Unknown EMAIL_PROVIDER "${PROVIDER}" (use "resend" or "sendgrid")`);
}
