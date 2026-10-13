# Included in every location block: nginx drops server-level add_header lines in any location that sets its own,
# so listing them once at server level would leave the SPA and asset responses without them.
#
# script-src 'self' is the important one: the access token lives in sessionStorage, so an injected script would be
# able to read it. Everything the app loads from elsewhere is named here:
#   fonts.googleapis.com / fonts.gstatic.com  web fonts          flagcdn.com   country flags
#   *.supabase.co                              waitlist form      *.moneygram.com   the cash-out widget (iframe)
# style-src needs 'unsafe-inline' because React sets style attributes; scripts do not.
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https://flagcdn.com; connect-src 'self' https://*.supabase.co; frame-src https://*.moneygram.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()" always;
