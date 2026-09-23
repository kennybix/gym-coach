# Use gym-coach on your phone (Samsung S26+) — Tailscale Serve

The whole app runs on this machine (the LLM is bolted here via the CLI proxy). Tailscale
**Serve** exposes it to **your tailnet only** over HTTPS — private, no public internet, no
droplet, no DNS. Your phone reaches it whenever Tailscale is on.

**App URL:** `https://gym-coach.<your-tailnet>.ts.net`  (served from a dedicated
Tailscale node — `gym-coach-tailscaled` + `gym-coach-serve` units, mirroring mynah)

Already done (app side, verified):
- Single origin — the frontend proxies `/api`,`/coach`,`/knowledge` to the backend.
- No credentials in the JS bundle — the phone is signed in by scanning a QR code from `pair.py`.
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

### 3. On the phone

1. Install **Tailscale** from the Play Store, sign in with **the same account as this machine**,
   and switch it **on**.
2. On the computer, in the gym-coach folder, run **`python pair.py`**. It shows three QR codes:
   1. **Install the app** — downloads the Android app (recommended: Health Connect, shortcuts,
      notification taps open it directly). Or skip it and use the site in Chrome, then
      **Add to Home screen** to install the PWA.
   2. **Notifications** — install **ntfy** from the Play Store first, then scan to subscribe to
      your private topic (weekly review, morning nudges, alerts). See
      [`NOTIFICATIONS.md`](NOTIFICATIONS.md).
   3. **Sign in** — in the app tap **Scan pairing code** (on Home when signed out, or
      Setup → Signed in) and scan. Scanning with the phone's camera instead opens the site in the
      browser and signs that in.
3. The first run walks you through a five-step setup; it opens by letting you pick a **look**.

**The sign-in code is your login** — don't share it or screenshot it. If you ever rotate
`SUPABASE_JWT_SECRET`, every device is signed out; run `python pair.py --sign-in` and scan again.
(That rotation once locked the phone out for ten days because re-pasting a 195-character token by
hand was the only way back in. Pairing by QR exists so that can't happen again.)

## Notes
- **Availability:** the app is up only while this machine is on/awake (the LLM lives here).
- **Security:** tailnet-only — your devices, signed in, are the gate. The bearer token is
  the data auth (unforgeable JWT). To go truly public later you'd add `tailscale funnel` — put
  an auth layer in front of it first.
- **After code changes:** `systemctl --user restart coach-backend`; for UI changes rebuild
  (`cd web && npm run build`) then restart `coach-frontend`. Serve config persists across
  reboots, and `gym-coach-serve.service` re-asserts it at boot.
