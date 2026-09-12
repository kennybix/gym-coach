# Security

## Reporting

This is a personal project, not a hosted service. If you find a vulnerability, please open a
GitHub security advisory (Security → Report a vulnerability) rather than a public issue.

## Threat model

The app is designed to run **on one machine you control**, reachable only over a private
network (Tailscale Serve, not Funnel). It has no multi-tenant isolation beyond the JWT
boundary, no rate limiting, and no account recovery. Do not put it on the open internet
without adding an authenticating reverse proxy in front of it.

## If you deploy it, get these right

- **`SUPABASE_JWT_SECRET` is mandatory.** Every endpoint authenticates with it. The service
  refuses to start without one, because verifying against an empty secret would let anyone
  forge a token for any user. Generate one with
  `python -c "import secrets; print(secrets.token_hex(32))"`.
- **Bearer tokens are long-lived and cannot be revoked individually.** Rotating
  `SUPABASE_JWT_SECRET` invalidates every token at once; that is the only revocation.
  Treat a token like a password: don't commit it, don't paste it into an issue, and don't
  screenshot the Setup screen with one visible.
- **Keep `.env` out of git.** It is gitignored; keep it that way.
- **The database holds health data** (weight, blood pressure, food, photos). Back it up
  somewhere you control (`deploy/backup_db.sh`), and remember progress photos live on disk at
  `PHOTO_DIR`, outside the repo.

## What the design already guarantees

- `user_id` comes only from a verified JWT, never from a request body or a model-supplied
  tool argument.
- The LLM cannot write to the database. It can only stage typed proposals; the `safety` and
  `commit` graph nodes perform every write.
- Photo and data endpoints are scoped by the authenticated `user_id`, so one user's token
  cannot read another's records.
- Target history is append-only at the database level.
