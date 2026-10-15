# First-deployment readiness

Verified on 2026-10-16 before a production server was available. This report records evidence from the split repositories and the local Docker deployment. It does not replace the hands-on [deployment and pilot checklist](DEPLOYMENT_CHECKLIST.md).

## Decision

**Application gate: pass. Public launch gate: blocked by infrastructure and owner checks.**

The application is ready to install on a server for final acceptance. Do not invite the pilot group until every item under **Required before launch** is complete.

## Verified

- Both GitHub repositories are private, use `main`, and only `vncntfr` has collaborator access.
- GitHub Actions passed on both audited `main` commits using the current Node 24 based `actions/checkout@v7` and `actions/setup-node@v7`: [frontend run 38773704218](https://github.com/vncntfr/ChudLog/actions/runs/38773704218) and [backend run 38773721245](https://github.com/vncntfr/ChudLog-API/actions/runs/38773721245).
- Frontend and backend shared domain sources are identical.
- Type checking, 74 automated tests, production builds, and both production-only Docker builds pass.
- `npm audit --omit=dev --audit-level=high` reports zero vulnerabilities in both repositories.
- No production environment file, database, backup, private key, cookie jar, or dependency directory is tracked by Git.
- The local production environment file is mode `0600`, uses `https://chudlog.xyz`, and contains a 64-byte session secret, VAPID key pair, and 32-byte backup encryption key.
- The API container runs as `node` with a read-only root filesystem. Both services disable privilege escalation, restart unless stopped, expose health checks, and cap JSON logs at three 10 MB files.
- Local registration, private-group creation, authenticated sessions, restart persistence, encrypted backup creation, and scratch restore passed. The backup health endpoint reported healthy.
- Session cookies are `__Host-` prefixed, `Secure`, `HttpOnly`, and `SameSite=Lax`. Integration tests cover hostile origins, invalid invitations without partial users, scoped account data, session expiry, and one-time recovery tokens.
- Caddy terminates the public connection and proxies `/api/*`. Its default forwarding behavior ignores untrusted incoming `X-Forwarded-*` values, so the auth limiter's client address cannot be selected by a direct client header.

## Required before launch

- [ ] Buy or provision the Linux server described in the deployment checklist and record its public IPv4 address.
- [ ] Set `ADMIN_EMAILS` and `VAPID_SUB` to an operator-controlled email address.
- [ ] Mount separately managed backup storage and change `BACKUP_HOST_PATH` from the local `./backups` fallback.
- [ ] Store the backup encryption key outside both the server and backup filesystem.
- [ ] Clone `ChudLog` and `ChudLog-API` beside one another on the server using a read-only deploy key or similarly scoped credential.
- [ ] Change the GoDaddy apex `A` records from the current parking addresses (`3.33.130.190`, `15.197.148.33`) to the server IPv4 address. No `AAAA` record currently exists.
- [ ] Start Compose, confirm Caddy obtains a trusted certificate, and verify the site from a network outside the server.
- [ ] Reboot the server and confirm containers restart and the SQLite volume persists.
- [ ] Put external monitors on `/api/health` and `/api/health/backup`, then deliberately test both alert paths.
- [ ] Confirm an encrypted backup stored off-host restores into a scratch database.
- [ ] Test Web Push on a real Android device and an installed iPhone PWA.
- [ ] Validate real Hevy and Strong exports, or disable import for the pilot.
- [ ] Complete the product-acceptance and privacy review sections of the deployment checklist.

## Known constraints

- `chudlog.xyz` currently resolves to GoDaddy parking and HTTPS fails with a certificate name error. This is expected before the DNS cutover and Caddy deployment.
- GitHub branch protection for these private repositories is unavailable on the current GitHub plan. Keep the sole-owner access model and require green CI before each manual deployment, or upgrade the plan before adding collaborators.
- The API image is about 392 MB and the web image about 81 MB. This is acceptable for the first private pilot but can be reduced later by compiling the API instead of running TypeScript through `tsx`.
- The current single-host Compose layout has a short interruption during upgrades. Schedule the first deployments during a maintenance window.

## Release It resilience score

Current strict score: **2/8**.

- Pass: outbound push calls use bounded timeouts.
- Pass: application and database liveness plus backup freshness have health endpoints.
- Missing: circuit breaker around the push provider.
- Missing: workload isolation for HTTP, notification, and backup work.
- Missing: zero-downtime replacement or draining.
- Missing: correlated structured telemetry across requests and background jobs.
- Missing: measured capacity/load test.
- Missing: automated failure-injection tests for disk, provider, and process failures.

These resilience gaps are acceptable only for the small private pilot described in the project notes. Add them before treating ChudLog as a general public or high-availability service.
