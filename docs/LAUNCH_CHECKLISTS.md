# ChudLog launch checklists

Status updated 2026-10-16. Check an item only after observing it in the named environment. **Local** evidence does not substitute for **production** evidence.

## Current decision

- [x] Application is ready to install on a server.
- [ ] Production deployment is ready to begin — **blocked until a server and operator email are provided**.
- [ ] Private pilot is ready to invite — **blocked until every Launch gate item passes**.

## Inputs needed from the owner

- [ ] Purchase a 64-bit Linux server with at least 2 vCPU, 2 GB RAM, 20 GB SSD, and a public IPv4 address.
- [ ] Send Codex the server IPv4 address and SSH connection details.
- [ ] Send Codex the operator-controlled email address for `ADMIN_EMAILS` and `VAPID_SUB`.
- [ ] Choose separately managed backup storage and provide its server mount path.
- [ ] Store the backup encryption key in a password manager or secret manager, separate from the server and backup files.
- [ ] Have one Android device and one iPhone available for notification acceptance tests.
- [ ] Provide one real Hevy export and one real Strong export, or approve disabling imports for the pilot.
- [ ] Decide whether `www.chudlog.xyz` should redirect to `chudlog.xyz`.

## Completed before server purchase

- [x] Frontend repository is private: [vncntfr/ChudLog](https://github.com/vncntfr/ChudLog).
- [x] Backend repository is private: [vncntfr/ChudLog-API](https://github.com/vncntfr/ChudLog-API).
- [x] Only `vncntfr` has collaborator access.
- [x] Frontend and backend are split into separate repositories.
- [x] Frontend CI passes on `main`: [run 38773704218](https://github.com/vncntfr/ChudLog/actions/runs/38773704218).
- [x] Backend CI passes on `main`: [run 38773932924](https://github.com/vncntfr/ChudLog-API/actions/runs/38773932924).
- [x] Type checking, 74 automated tests, production builds, and Docker image builds pass.
- [x] Production dependency audits report zero vulnerabilities.
- [x] Shared domain sources are identical in both repositories.
- [x] Production environment material was generated locally for `https://chudlog.xyz`.
- [x] `.env.production` is mode `0600`, ignored by Git, and absent from repository history.
- [x] Session secret, VAPID keys, and backup encryption key have valid lengths.
- [x] API container runs as non-root with a read-only root filesystem.
- [x] Web container runs with a read-only root filesystem.
- [x] Both services disable privilege escalation and use `unless-stopped` restart policies.
- [x] Both services have health checks and logs capped at three 10 MB files per service.
- [x] Local registration, private-group creation, authenticated session persistence, API restart, encrypted backup creation, and scratch restore pass.
- [x] Local `/api/health` and `/api/health/backup` return HTTP 200.
- [x] Session-cookie, hostile-origin, account-scoping, invalid-invitation, session-expiry, and recovery-token integration tests pass.

## Server provisioning checklist — Codex can perform after access is provided

- [ ] Confirm the host meets the CPU, memory, disk, architecture, and public IPv4 requirements.
- [ ] Create a non-root deployment user with key-only SSH access.
- [ ] Disable password SSH authentication and direct root login.
- [ ] Enable automatic security updates and time synchronization.
- [ ] Install supported Docker Engine and Docker Compose versions.
- [ ] Configure the firewall for restricted SSH plus public TCP 80/443 and UDP 443.
- [ ] Mount the separately managed backup filesystem.
- [ ] Confirm the API container user can write to the backup mount.
- [ ] Install read-only GitHub deploy credentials and clone `ChudLog/` beside `ChudLog-API/`.
- [ ] Copy `.env.production` through an encrypted channel and confirm mode `0600`.
- [ ] Set the supplied operator email in `ADMIN_EMAILS` and `VAPID_SUB`.
- [ ] Set `BACKUP_HOST_PATH` to the separately managed mount.
- [ ] Run `docker compose --env-file .env.production config --quiet`.

## GoDaddy DNS checklist — requires the server IPv4 address

- [ ] Record the existing GoDaddy DNS records before changing them.
- [ ] Replace the parked apex `A` records (`3.33.130.190` and `15.197.148.33`) with the server IPv4 address.
- [ ] Do not create `AAAA` unless the server has tested public IPv6.
- [ ] Configure `www` only after the owner decides whether it is needed.
- [ ] Confirm public resolvers return the new server address.
- [ ] Confirm no restrictive CAA record prevents Caddy from issuing a certificate.

## First production deployment checklist — Codex can perform

- [ ] Start the stack with `docker compose --env-file .env.production up -d --build`.
- [ ] Confirm the API and web containers reach healthy status.
- [ ] Confirm `https://chudlog.xyz` presents a publicly trusted certificate for the domain.
- [ ] Confirm `https://chudlog.xyz/api/health` returns HTTP 200 and `ok: true`.
- [ ] Confirm security headers and the production session cookie attributes.
- [ ] Confirm an unapproved state-changing origin receives HTTP 403.
- [ ] Confirm repeated authentication failures receive HTTP 429.
- [ ] Confirm browser developer tools show no mixed-content, network, service-worker, or console errors.
- [ ] Create a production smoke-test account and private group.
- [ ] Restart the API and confirm its account, group, and session persist.
- [ ] Reboot the server and confirm both containers restart and SQLite persists.
- [ ] Confirm logs stay within configured limits and contain no credentials or personal exports.

## Backup and monitoring checklist — Codex can configure; owner verifies alert delivery

- [ ] Confirm an encrypted `.clbak` file appears on separately managed storage after 02:00 WIB.
- [ ] Confirm `/api/health/backup` returns HTTP 200 with `status: ok`.
- [ ] Restore the deployed snapshot into a new scratch database.
- [ ] Confirm authenticated decryption, SQLite integrity, and foreign-key checks pass.
- [ ] Compare restored user and audit-event counts with production.
- [ ] Set backup retention and capacity alerts on the storage provider.
- [ ] Configure an external 1–5 minute monitor for `/api/health`.
- [ ] Configure a separate external monitor for `/api/health/backup`.
- [ ] Stop the stack deliberately and confirm the owner receives the uptime alert.
- [ ] Make the backup target temporarily unwritable and confirm the owner receives the backup alert.
- [ ] Record rollback, restore, session-revocation, and maintenance commands.

## Product acceptance checklist — owner and Codex review together

- [ ] Create account A and a new private group.
- [ ] Join that group from account B using its invitation code.
- [ ] Confirm both accounts can create independent groups.
- [ ] Confirm an invalid invitation creates no partial account.
- [ ] Log food, correct it, and reuse a saved food.
- [ ] Log green, yellow, and red sleep examples and verify heatmap colors, duration chart, and reason labels.
- [ ] Log a REST day and confirm gym completion awards zero points.
- [ ] Replace REST with a real working set and confirm points are awarded once.
- [ ] Save a routine and complete its guided workout.
- [ ] Review group checklists, activity, member details, and both leaderboards.
- [ ] Export an account and inspect the downloaded JSON.
- [ ] Test offline drafts, reconnect replay, reload persistence, and account switching.
- [ ] Validate the real Hevy and Strong exports, or disable imports for the pilot.

## Push-notification checklist — requires real devices

- [ ] On Android, enable reminders and receive a test notification.
- [ ] Install the PWA on an iPhone Home Screen, enable reminders, and receive a test notification.
- [ ] Tap a notification on each device and confirm it opens the intended screen.
- [ ] Confirm an expired subscription is removed.
- [ ] Confirm a transient provider failure is retried with bounded attempts.
- [ ] Confirm the 23:00 WIB final reminder and midnight deadline language are correct.

## Privacy and owner review checklist

- [ ] Confirm group views never reveal email, password material, raw bodyweight, or private nutrition inputs.
- [ ] Exercise account recovery through the private operator channel and confirm the token works once, expires, and revokes old sessions.
- [ ] Review the provisional strength mapping and its limitations.
- [ ] Review the privacy disclosures and decide who may join the pilot.
- [ ] Document how a pilot member requests data export and deletion.

## Launch gate — every item is mandatory

- [x] Both current GitHub CI runs pass.
- [ ] Domain and trusted HTTPS work from a network outside the server.
- [ ] Registration, group creation, invitation joining, logging, and restart persistence pass in production.
- [ ] Android and installed-iPhone notification delivery pass.
- [ ] A real encrypted off-host backup restores successfully.
- [ ] Uptime and backup alerts are received during deliberate tests.
- [ ] Real import fixtures pass or imports are disabled for the pilot.
- [ ] The owner approves the strength mapping, privacy disclosures, and pilot membership.
- [ ] No unresolved severity-high deployment issue remains.

When the final unchecked item passes, record the date, deployed commit IDs, server image/version, and reviewer name below.

- Launch date: `TBD`
- Frontend commit: `TBD`
- Backend commit: `TBD`
- Server image/version: `TBD`
- Reviewed by: `TBD`
