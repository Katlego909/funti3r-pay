# Included in every location block (nginx drops server-level add_header lines in a location that sets its own).
# The admin console loads nothing from anywhere else, so its policy is 'self' only. style-src needs 'unsafe-inline'
# because React sets style attributes; scripts do not.
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "camera=(), microphone=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()" always;
