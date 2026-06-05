# Use gym-coach on your phone (Samsung S26+) — Tailscale Serve

The whole app runs on this machine (the LLM is bolted here via the CLI proxy). Tailscale
**Serve** exposes it to **your tailnet only** over HTTPS — private, no public internet, no
droplet, no DNS. Your phone reaches it whenever Tailscale is on.

**App URL:** `https://quantoptimus.taile8b1de.ts.net`

Already done (app side, verified):
- Single origin — the frontend proxies `/api`,`/coach`,`/knowledge` to the backend.
- No credentials in the JS bundle (token is entered once on the device).
- Backend, frontend, LiteLLM run as systemd services (auto-start at boot).

## 3 steps for you

### 1. Enable HTTPS for your tailnet (one click, one time)
Open <https://login.tailscale.com/admin/dns> → **Enable HTTPS**. (MagicDNS must be on; it is.)

### 2. Turn on serving (on this machine, one time)
```bash
cd ~/Documents/Projects/gym-coach
sudo bash deploy/tailscale-serve.sh
```
You should see a mapping `https://quantoptimus.taile8b1de.ts.net → http://127.0.0.1:3010`.

### 3. On the S26+
1. Install **Tailscale** from the Play Store, sign in as **oyetundedamilare@gmail.com**, toggle it **on**.
2. Open **`https://quantoptimus.taile8b1de.ts.net`** in Chrome.
3. Go to **Setup** → paste your **bearer token** (below) into "Bearer token" → **Save**.
   (Leave "API base URL" blank — it uses the site automatically.)
4. Chrome menu → **Add to Home screen** to install the PWA. Open it from the icon —
   full-screen, offline-capable, and barcode-camera works (real HTTPS).

**Your token** (1-year, user with your existing data):
```
<paste your token — mint with: SUPABASE_JWT_SECRET=... python mint_token.py 11111111-1111-1111-1111-111111111111>
```

## Notes
- **Availability:** the app is up only while this machine is on/awake (the LLM lives here).
- **Security:** tailnet-only — your devices, signed in, are the gate. The bearer token is
  the data auth (unforgeable JWT). To go truly public later, see the Funnel line in
  `tailscale-serve.sh` and add an auth layer first.
- **After code changes:** `systemctl --user restart coach-backend` (and rebuild + restart
  `coach-frontend` for UI changes). Serve config persists across reboots.
