# Use gym-coach on your phone (Samsung S26+) — Tailscale Serve

The whole app runs on this machine (the LLM is bolted here via the CLI proxy). Tailscale
**Serve** exposes it to **your tailnet only** over HTTPS — private, no public internet, no
droplet, no DNS. Your phone reaches it whenever Tailscale is on.

**App URL:** `https://gym-coach.<your-tailnet>.ts.net`  (served from a dedicated
Tailscale node — `gym-coach-tailscaled` + `gym-coach-serve` units, mirroring mynah)

Already done (app side, verified):
- Single origin — the frontend proxies `/api`,`/coach`,`/knowledge` to the backend.
- No credentials in the JS bundle (token is entered once on the device).
- Backend, frontend, LiteLLM run as systemd services (auto-start at boot).

## 3 steps for you

### 1. Enable HTTPS for your tailnet (one click, one time)
Open <https://login.tailscale.com/admin/dns> → **Enable HTTPS**. (MagicDNS must be on; it is.)

### 2. Turn on serving (on this machine, one time)

The gym has its **own** userspace Tailscale node so it can't clash with the sibling `mynah`
app, and two systemd units keep it up. They're already installed and enabled here; on a fresh
machine:

```bash
cp deploy/systemd/gym-coach-*.service ~/.config/systemd/user/ && systemctl --user daemon-reload
systemctl --user enable --now gym-coach-tailscaled.service
SOCK=~/.local/share/tailscale-gym-coach/tailscaled.sock
sudo tailscale --socket=$SOCK up --hostname=gym-coach     # auth this node once
systemctl --user enable --now gym-coach-serve.service
tailscale --socket=$SOCK serve status                      # expect :3010 on the gym-coach host
```

You should see `https://gym-coach.<your-tailnet>.ts.net → http://127.0.0.1:3010`.
(`deploy/tailscale-serve.sh` is the retired shared-node version — don't run it; it would reset
the other app's serve config.)

### 3. On the S26+
1. Install **Tailscale** from the Play Store, sign in with **the same account as this machine**, toggle it **on**.
2. Open **`https://gym-coach.<your-tailnet>.ts.net`** in Chrome.
3. Tap the **gear** on Home → **Signed in** → paste your **bearer token** (below) → **Save**.
   (Leave "Server URL" blank — it uses the site automatically.)
4. Chrome menu → **Add to Home screen** to install the PWA. Open it from the icon —
   full-screen, offline-capable, and barcode-camera works (real HTTPS).
5. First run walks you through a five-step wizard; it opens by letting you pick a **look**
   (Volt, Paper, Ember, Glacier, Mono, or Auto — changeable any time under Setup → Look).

**Your token** — mint one on this machine and paste it into the app; never commit it, and
never screenshot the Setup screen with it visible:
```bash
set -a; . ./.env; set +a
python mint_token.py <your-user-uuid>
```

## Or install the Android app

The PWA covers everything except **Health Connect import** and **local notifications**, which
need the native shell. To sideload it: `bash deploy/build-apk.sh`, restore the server build
(`(cd web && npm run build) && systemctl --user restart coach-frontend`), then download
`https://gym-coach.<your-tailnet>.ts.net/gym-coach.apk` on the phone. Details:
[`ANDROID_APP.md`](ANDROID_APP.md). After installing, run [`DEVICE_SMOKE.md`](DEVICE_SMOKE.md).

## Notes
- **Availability:** the app is up only while this machine is on/awake (the LLM lives here).
- **Security:** tailnet-only — your devices, signed in, are the gate. The bearer token is
  the data auth (unforgeable JWT). To go truly public later you'd add `tailscale funnel` — put
  an auth layer in front of it first.
- **After code changes:** `systemctl --user restart coach-backend`; for UI changes rebuild
  (`cd web && npm run build`) then restart `coach-frontend`. Serve config persists across
  reboots, and `gym-coach-serve.service` re-asserts it at boot.
