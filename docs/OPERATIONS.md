# Operate a private ChudLog instance

This guide is for the operator with shell access to the repository and database. Configure and verify these procedures before inviting the pilot group.

## Create and verify an encrypted backup

The snapshot tool uses SQLite's consistent backup API and AES-256-GCM. It creates files with owner-only permissions, refuses to overwrite destinations, and removes the temporary plaintext snapshot. Keep the encryption key separately from backup storage.

1. Generate a 32-byte key and save it in your secret manager:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
   ```

2. Set `BACKUP_ENCRYPTION_KEY` in your shell environment using your secret manager. The CLI reads this variable from the process environment, even when `.env` also contains a server backup key.

3. Create a snapshot from the repository root:

   ```sh
   npm --workspace api run backup -- create BACKUP_FILE
   ```

   Replace `BACKUP_FILE` with a new absolute `.clbak` path on your backup target. The source database follows the root configuration and the `DB_PATH` environment override.

4. Restore into a new scratch path:

   ```sh
   npm --workspace api run backup -- restore BACKUP_FILE SCRATCH_DB
   ```

   Replace `SCRATCH_DB` with a new absolute SQLite path. Successful output reports user and audit-event counts after authenticated decryption, SQLite integrity checking, and foreign-key checking. A damaged or incorrectly keyed snapshot fails.

5. Inspect the scratch database or run a separate test instance against a copy. Confirm expected records before planning a production recovery. The restore command never switches or overwrites the running database.

For daily snapshots, set both `BACKUP_DIRECTORY` and `BACKUP_ENCRYPTION_KEY` in the server configuration and restart. After 02:00 WIB, the worker writes one successful encrypted snapshot per date; a failed attempt retries on a later minute. The `meta` records `backup:last_day`, `backup:last_success`, and `backup:last_failure` describe worker outcomes. Failures also log to stderr.

Mount an off-box target into the server or container and monitor it externally. Compose does not mount backup storage by default. Configure retention and failure alerts at the storage/monitoring layer; this app does not delete old backups or notify an external operator. A local encrypted snapshot alone does not protect against host loss.

## Recover an account

Verify the requester's identity through your established private channel before issuing a token. From the repository root, run:

```sh
npm --workspace api run reset:issue -- ACCOUNT_EMAIL
```

Replace `ACCOUNT_EMAIL` with the exact account email. The command prints a single-use token valid for 30 minutes. Deliver it privately to the owner; do not paste it into public logs. The owner selects **Recover account** on the sign-in screen and submits the token with a replacement password. Successful consumption revokes existing sessions and records an audit event. Issuing another token invalidates earlier unused tokens. There is no unauthenticated token-issuance endpoint or automatic email delivery.

## Configure and verify Web Push

1. Generate VAPID material:

   ```sh
   npm --workspace api run vapid:gen
   ```

2. Store the resulting public/private keys in `.env` and set `VAPID_SUB` to a valid operator contact. Keep the private key on the server. Restart the API.
3. Serve the app from your configured HTTPS `PUBLIC_ORIGIN`. On iOS, install it on the Home Screen and open that installed app.
4. Sign in, open **Profile**, and enable reminders on that device. Grant browser permission, then use the test notification control.
5. Verify arrival and notification navigation on each target platform. A provider accepting a request does not guarantee that the OS displays it.

The worker bundles owed trackers into one job per user/hour from 08:00 through 23:00 WIB. Food starts at 13:00; sleep and gym start at 08:00. An optional morning status reminder has its own preference. Accepted endpoints are not retried; transient failures get bounded retries, expired subscriptions are removed, and stale or satisfied jobs expire. The browser does not poll or run background sync.

## Verify deployment

Build and run the Docker/Caddy stack on the target host. Set the real domain, matching `PUBLIC_ORIGIN`, production secrets, persistent database storage, and an off-host backup mount. Production Compose publishes ports 80 and 443; `compose.local.yaml` switches Caddy to browser-trusted HTTP only for local testing. Verify health, secure sessions, persistence after restart, migrations, backup recovery, and device push before admitting the pilot group.

## Monitor uptime and backups

Use two checks because they answer different questions. `GET /api/health` verifies that the web process can read SQLite; Docker uses this endpoint and may restart the API if it fails. `GET /api/health/backup` verifies the recovery path and returns HTTP 503 while backups are unconfigured, awaiting their first successful run, newer-failed-than-successful, or more than 36 hours old. A backup failure should alert the operator without restarting an otherwise healthy application.

Configure an external monitoring service to request the app health endpoint every one to five minutes and the backup endpoint at least hourly. Deliver failures to a channel the operator will actually notice. Test both alerts deliberately: stop the stack for the uptime alert, then make the backup mount temporarily unwritable for the backup alert. The monitor must run outside the application server; an on-server check disappears during the same outage it is supposed to report.

Follow [the deployment and pilot checklist](DEPLOYMENT_CHECKLIST.md) for the complete release review.
