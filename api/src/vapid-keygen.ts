// One-time VAPID key generation (RFC 8292, EC P-256 — exactly what
// web-push.generateVAPIDKeys produces: Base64URL keys, ES256 JWT signs).
// Run: npm --workspace api run vapid:gen   →   paste the two lines into .env
import * as webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log('# --- add to .env ---');
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
