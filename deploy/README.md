# Deployment (systemd --user)

Local/single-host hardening: run the backend, frontend, weekly review, and nightly
backups as **user** systemd units (no root needed). All units read configuration from
the repo's `.env` via `EnvironmentFile`.

## Units

| Unit | Type | What it does |
|---|---|---|
| `coach-backend.service`  | service | uvicorn API on `127.0.0.1:8010`, auto-restart |
| `coach-frontend.service` | service | `next start` PWA on `:3010` (Node 20), auto-restart |
| `coach-litellm.service`  | service | LiteLLM gateway on `:4000` — embeddings (Ollama) + chat (CLIProxyAPI) |
| `coach-review.service` + `.timer`  | oneshot + timer | weekly proactive review, Mondays 07:00 |
| `coach-backup.service` + `.timer`  | oneshot + timer | nightly `pg_dump` of `coachdb`, 02:30, 14-day rotation |

The RAG embeddings path depends on `coach-litellm.service` (and Ollama). See
[`litellm/README.md`](litellm/README.md).

## Install

```bash
mkdir -p ~/.config/systemd/user
cp deploy/systemd/*.service deploy/systemd/*.timer ~/.config/systemd/user/
systemctl --user daemon-reload

# long-running app (+ gateway for RAG embeddings)
systemctl --user enable --now coach-backend.service coach-frontend.service coach-litellm.service
# scheduled jobs
systemctl --user enable --now coach-review.timer coach-backup.timer

# survive logout / run at boot without an active login session:
sudo loginctl enable-linger "$USER"
```

## Operate

```bash
systemctl --user status coach-backend coach-frontend
systemctl --user list-timers 'coach-*'
journalctl --user -u coach-review.service -n 50          # last review run
systemctl --user start coach-review.service              # run a review now
systemctl --user start coach-backup.service              # back up now
```

## Notes
- **Node path** is pinned in `coach-frontend.service` (`~/.nvm/.../v20.20.2/bin`).
  Update it if you change Node versions; Tailwind v4 needs Node ≥ 20.
- **Backups** land in `~/.local/share/gym-coach/backups` (override `COACH_BACKUP_DIR`,
  retention `COACH_BACKUP_KEEP`). Restore: `gunzip -c <file>.sql.gz | psql "$COACH_DB_URI"`.
- **HTTPS**: the backend binds loopback only. For LAN/phone access over TLS, front it
  with a reverse proxy (Caddy/nginx) terminating HTTPS — out of scope for these units.
