import { randomBytes } from 'node:crypto';
import { chmod, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import webpush from 'web-push';

const domain = (process.argv[2] ?? 'chudlog.xyz').trim().toLowerCase();
const destination = resolve(process.cwd(), process.argv[3] ?? '.env.production');
if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
  throw new Error('Pass a bare domain, for example: npm run env:production -- chudlog.xyz');
}

const vapid = webpush.generateVAPIDKeys();
const lines = [
  'NODE_ENV=production',
  'HOST=0.0.0.0',
  'PORT=8787',
  'DB_PATH=/data/chudlog.db',
  `PUBLIC_ORIGIN=https://${domain}`,
  'ALLOWED_ORIGINS=',
  `SITE_ADDRESS=${domain}`,
  `SESSION_SECRET=${randomBytes(48).toString('base64')}`,
  `VAPID_PUBLIC_KEY=${vapid.publicKey}`,
  `VAPID_PRIVATE_KEY=${vapid.privateKey}`,
  `VAPID_ADMIN_EMAIL=admin@${domain}`,
  `VAPID_SUB=mailto:admin@${domain}`,
  'ADMIN_EMAILS=',
  'BACKUP_DIRECTORY=/backups',
  `BACKUP_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,
  'BACKUP_HOST_PATH=./backups',
  '',
];

const handle = await open(destination, 'wx', 0o600);
try {
  await handle.writeFile(lines.join('\n'), 'utf8');
} finally {
  await handle.close();
}
await chmod(destination, 0o600);
console.log(`Created ${destination} for https://${domain} with mode 0600. Secret values were not printed.`);
