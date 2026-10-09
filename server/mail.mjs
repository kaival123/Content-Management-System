// Platform-wide email. The admin configures ONE sender for the whole platform (Platform
// Settings page); it sends for every website, each to that site's own recipient (the
// contact form's "Send form submissions to"). Three providers:
//   - smtp     : the admin's own email account (Gmail/Outlook/business), via nodemailer
//   - resend   : Resend REST API
//   - sendgrid : SendGrid REST API
//
// Config comes from the database first, then env vars:
//   EMAIL_PROVIDER = smtp | resend | sendgrid
//   EMAIL_FROM     = sender, e.g. "CMS <no-reply@yourdomain.com>"
//   EMAIL_API_KEY  = provider API key (resend/sendgrid)
//   EMAIL_SMTP_HOST / EMAIL_SMTP_PORT / EMAIL_SMTP_SECURE / EMAIL_SMTP_USER / EMAIL_SMTP_PASS (smtp)

import nodemailer from 'nodemailer';

let override = null; // set at runtime from the DB (Platform Settings)

/** Applies email config saved in the database; null falls back to env vars. */
export function setEmailConfig(cfg) {
  override = cfg ?? null;
}

function config() {
  if (override) return override;
  return {
    provider: (process.env.EMAIL_PROVIDER ?? '').toLowerCase(),
    from: process.env.EMAIL_FROM ?? '',
    apiKey: process.env.EMAIL_API_KEY ?? '',
    smtp: {
      host: process.env.EMAIL_SMTP_HOST ?? '',
      port: Number(process.env.EMAIL_SMTP_PORT) || 587,
      secure: process.env.EMAIL_SMTP_SECURE === '1',
      user: process.env.EMAIL_SMTP_USER ?? '',
      pass: process.env.EMAIL_SMTP_PASS ?? '',
    },
  };
}

export function emailConfigured() {
  const c = config();
  if (!c.from) return false;
  if (c.provider === 'smtp') return !!(c.smtp?.host && c.smtp?.user && c.smtp?.pass);
  if (c.provider === 'resend' || c.provider === 'sendgrid') return !!c.apiKey;
  return false;
}

/**
 * Sends a plain-text email through the configured provider. { skipped } when unconfigured.
 * `replyTo` (optional) is the address a "Reply" should go to — e.g. the person who submitted
 * the form, so the site owner can reply to them directly.
 */
export async function sendEmail({ to, subject, text, replyTo }) {
  const c = config();
  if (!emailConfigured()) return { skipped: true };
  const validReplyTo = replyTo && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(replyTo) ? replyTo : undefined;

  if (c.provider === 'smtp') {
    const transport = nodemailer.createTransport({
      host: c.smtp.host,
      port: Number(c.smtp.port) || 587,
      secure: c.smtp.secure === true || Number(c.smtp.port) === 465,
      auth: { user: c.smtp.user, pass: c.smtp.pass },
    });
    await transport.sendMail({ from: c.from, to, subject, text, ...(validReplyTo ? { replyTo: validReplyTo } : {}) });
    return { ok: true };
  }

  if (c.provider === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: c.from, to: [to], subject, text, ...(validReplyTo ? { reply_to: validReplyTo } : {}) }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
    return { ok: true };
  }

  if (c.provider === 'sendgrid') {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: c.from },
        ...(validReplyTo ? { reply_to: { email: validReplyTo } } : {}),
        subject,
        content: [{ type: 'text/plain', value: text }],
      }),
    });
    if (!res.ok && res.status !== 202) throw new Error(`SendGrid ${res.status}: ${await res.text()}`);
    return { ok: true };
  }

  throw new Error(`Unknown email provider "${c.provider}" (use "smtp", "resend" or "sendgrid")`);
}
