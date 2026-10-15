# Deployment and pilot review checklist

Use this list after a server has a public IPv4 address. Do not invite the group until every item in **Launch gate** is checked.

## Repository and ownership

- [ ] [ChudLog](https://github.com/vncntfr/ChudLog) and [ChudLog-API](https://github.com/vncntfr/ChudLog-API) are private.
- [ ] Only intended administrators have repository access.
- [ ] GitHub Actions passes on both `main` branches.
- [ ] The frontend and backend are cloned beside one another as `ChudLog/` and `ChudLog-API/`.
- [ ] The server can pull both repositories without storing a personal password.

## Server baseline

- [ ] Supported 64-bit Linux host with at least 2 vCPU, 2 GB RAM, 20 GB SSD, and a public IPv4 address.
- [ ] SSH uses keys; password login and direct root login are disabled.
- [ ] System security updates are enabled.
- [ ] Docker Engine and Docker Compose are installed.
- [ ] Firewall allows SSH from the operator's IP and public TCP 80/443 plus UDP 443.
- [ ] A remote or separately managed filesystem is mounted for encrypted backups.
- [ ] The backup mount is writable by the API container user.

## GoDaddy DNS for chudlog.xyz

- [ ] Set the apex `A` record (`@`) to the server's public IPv4 address.
- [ ] Remove conflicting parked-domain `A` records.
- [ ] Add an `AAAA` record only when the server has working public IPv6.
- [ ] Decide whether `www.chudlog.xyz` is needed before adding its CNAME and Caddy redirect.
- [ ] Confirm public DNS resolves to the new server before expecting Caddy certificate issuance.

## Production secrets

- [ ] Run `npm run env:production -- chudlog.xyz` in `ChudLog-API`.
- [ ] Set `ADMIN_EMAILS` to the operator accounts that may issue recovery tokens.
- [ ] Set `BACKUP_HOST_PATH` to the mounted backup filesystem.
- [ ] Copy `.env.production` to the server through an encrypted administrator channel.
- [ ] Confirm `.env.production` is mode `0600` and absent from Git.
- [ ] Store the backup encryption key separately from both the server and backup files.
- [ ] Keep a secure operator copy of the VAPID keys; changing them invalidates existing push subscriptions.

## First deployment

- [ ] Run `docker compose --env-file .env.production config --quiet`.
- [ ] Run `docker compose --env-file .env.production up -d --build`.
- [ ] Confirm both services are running and the API is healthy.
- [ ] Open `https://chudlog.xyz` and confirm the certificate is valid for the domain.
- [ ] Confirm `https://chudlog.xyz/api/health` returns `ok: true`.
- [ ] Confirm browser developer tools show no mixed-content, network, or console errors.
- [ ] Restart the API container and confirm the same account, group, and session still work.
- [ ] Reboot the server once and confirm the stack starts and the database persists.

## Product acceptance

- [ ] Create a new account and a new private group.
- [ ] Copy its invitation code and join from a second account.
- [ ] Confirm each account can also create an independent group.
- [ ] Confirm an invalid invitation creates no partial user.
- [ ] Log food, correct it, and reuse a saved food.
- [ ] Log green, yellow, and red sleep examples; review the heatmap, duration chart, and reason labels.
- [ ] Log a REST day and confirm it completes gym with zero points.
- [ ] Replace REST with a real working set and confirm points are awarded once.
- [ ] Save a routine and complete its guided workout.
- [ ] Review group checklists, activity, member details, and both leaderboards.
- [ ] Export an account's data and inspect the downloaded JSON.
- [ ] Validate one real Hevy export and one real Strong export before relying on imports.
- [ ] Test offline drafts, reconnect replay, reload persistence, and account switching.

## Security and privacy

- [ ] Session cookie is `Secure`, `HttpOnly`, `SameSite=Lax`, and `__Host-` prefixed.
- [ ] A state-changing request from an unapproved origin returns 403.
- [ ] Repeated login failures and request bursts receive 429 responses.
- [ ] Group responses reveal no email, password material, raw bodyweight, or private nutrition inputs.
- [ ] Recovery tokens are delivered privately, work once, expire, and revoke old sessions.
- [ ] No `.env.production`, database, restored database, backup, cookie jar, or personal export appears in Git or logs.

## Push notifications

- [ ] Enable reminders on an Android device and send a test notification.
- [ ] Install the PWA on an iPhone Home Screen, enable reminders there, and send a test.
- [ ] Confirm a notification tap opens the intended ChudLog screen.
- [ ] Confirm an expired subscription is removed and a transient provider failure is retried.
- [ ] Confirm the 23:00 WIB final reminder and midnight deadline language are correct.

## Backups and recovery

- [ ] After 02:00 WIB, confirm an encrypted `.clbak` file appears on the mounted target.
- [ ] Confirm `/api/health/backup` returns HTTP 200 with `status: ok`.
- [ ] Restore a deployed snapshot into a new scratch database.
- [ ] Confirm the restored user and audit-event counts are plausible.
- [ ] Run SQLite integrity and foreign-key checks through the restore command.
- [ ] Confirm backup retention will not fill the destination.
- [ ] Simulate a backup write failure and confirm the backup monitor alerts.
- [ ] Confirm loss of the application server would not also destroy every backup.

## Monitoring and incident response

- [ ] External uptime monitor checks `https://chudlog.xyz/api/health` every 1–5 minutes.
- [ ] Separate monitor checks `https://chudlog.xyz/api/health/backup`; HTTP 503 means unconfigured, pending, failed, or stale.
- [ ] Alerts reach at least one channel checked by the operator when asleep or away from a computer.
- [ ] Container logs have bounded retention at the host level.
- [ ] Operator can view disk usage, memory, container restarts, and certificate errors.
- [ ] Record the commands for rollback, database restore, session revocation, and temporary maintenance.

## Launch gate

- [ ] Both GitHub CI runs pass.
- [ ] Domain and HTTPS work from a network outside the server.
- [ ] Registration, group creation, invitation joining, logging, and restart persistence pass.
- [ ] Android and installed-iOS push delivery pass.
- [ ] A real encrypted deployed backup restores successfully.
- [ ] Uptime and backup alerts are received during a deliberate test.
- [ ] Real import fixtures pass or imports are explicitly disabled for the pilot.
- [ ] The owner has reviewed the provisional strength mapping and privacy disclosures.
