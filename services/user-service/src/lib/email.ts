import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('Email');

const FROM = 'Funti3rPay <noreply@funti3r.xyz>';

function recoveryHtml(link: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:'DM Sans',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:48px 24px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;border:1px solid #e5e7eb;padding:40px 48px">
        <tr><td style="padding-bottom:32px">
          <span style="font-size:22px;font-weight:900;color:#420a63;letter-spacing:-0.5px">Funti3rPay</span>
        </td></tr>
        <tr><td>
          <h2 style="margin:0 0 12px;font-size:22px;font-weight:900;color:#0a111c">Sign in on a new device</h2>
          <p style="margin:0 0 28px;font-size:15px;color:#4b5563;line-height:1.6">
            We received a request to access your Funti3rPay account from a new device.
            Click the button below to sign in — the link expires in <strong>15 minutes</strong>.
          </p>
          <a href="${link}" style="display:inline-block;padding:14px 32px;background:#420a63;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px">
            Sign in to Funti3rPay
          </a>
          <p style="margin:28px 0 0;font-size:13px;color:#9ca3af;line-height:1.6">
            If you didn't request this, you can safely ignore this email. Your account remains secure.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendRecoveryEmail(to: string, link: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    // Dev mode: log the link so the flow can be tested without an email provider
    logger.warn('RESEND_API_KEY not set — recovery link (dev only):', { to, link });
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to,
      subject: 'Sign in to Funti3rPay on your new device',
      html: recoveryHtml(link),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Email send failed (${res.status}): ${body}`);
  }

  logger.info('Recovery email sent', { to });
}
