# Push notifications (ntfy, tailnet-only)

The server reaches the phone through a **self-hosted [ntfy](https://ntfy.sh) server** on this
machine. Nothing goes through a third-party push service: ntfy listens on loopback, and the gym's
dedicated Tailscale node exposes it at `https://gym-coach.<your-tailnet>.ts.net:8443`, so only your
own devices can reach it.

## What gets sent

| When | Sender | Message | Tap opens |
|---|---|---|---|
| Monday 07:00 (daily catch-up if Monday failed) | `coach-review.timer` → `coach.run_review --if-missing` | The weekly review headline and summary, plus any target recalibration | Coach |
| 08:30 on days with something to do | `coach-daily.timer` → `coach.daily` | Today's workout and/or a weigh-in prompt | The workout, or the weigh-in sheet |
| Every AI model rate-limited | `coach.run_review` | "Weekly review delayed", with when a model is expected back (once a week, not daily) | Coach |
| A scheduled job crashes | systemd `OnFailure=coach-alert@%n.service` | Which unit failed and where to look | — |

The morning nudge is deliberately calm (`coach/daily.py`): at most one a day, only when there's a
scheduled workout or no weigh-in for two days, **never a weigh-in prompt for anyone who disclosed an
eating-disorder history**, and after 14 quiet days it drops to a Monday "fresh start" message.

## Server setup (already done on this machine)

```bash
# 1. the ntfy binary (verify the release checksum)
V=2.28.0
curl -sSLO https://github.com/binwiederhier/ntfy/releases/download/v$V/ntfy_${V}_linux_amd64.tar.gz
curl -sSLO https://github.com/binwiederhier/ntfy/releases/download/v$V/checksums.txt
grep ntfy_${V}_linux_amd64.tar.gz checksums.txt | sha256sum -c -
tar xzf ntfy_${V}_linux_amd64.tar.gz && install -m 0755 ntfy_${V}_linux_amd64/ntfy ~/.local/bin/ntfy

# 2. .env (see .env.example) — the topic is a secret; generate an unguessable one
COACH_NTFY_URL=https://gym-coach.<your-tailnet>.ts.net:8443
COACH_NTFY_PUBLISH_URL=http://127.0.0.1:2586
COACH_NTFY_TOPIC=gc-<22 random characters>
COACH_NOTIFY_USERS=<your account id>      # only this account's reviews/nudges are pushed
COACH_NOTIFY_LINKS=app                    # taps open the Android app; "web" opens the PWA

# 3. units
cp deploy/systemd/coach-ntfy.service deploy/systemd/gym-coach-serve.service \
   deploy/systemd/coach-daily.* deploy/systemd/coach-review.* deploy/systemd/coach-alert@.service \
   ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now coach-ntfy.service coach-daily.timer
systemctl --user restart coach-review.timer gym-coach-serve.service
```

## Phone setup

Run `python pair.py` on the computer and scan code **2**, or in the ntfy app add a subscription
with server `https://gym-coach.<your-tailnet>.ts.net:8443` and your topic. In ntfy's settings allow
it to run in the background, otherwise messages wait until you open it. Tailscale must be on.

## Testing

```bash
set -a; . ./.env; set +a
python -m coach.notify --title "Test" --message "Hello from the server"   # one-off push
python -m coach.daily --dry-run                                           # what today's nudge would be
systemctl --user start coach-alert@selftest.service                      # the failure alert path
curl -sN "$COACH_NTFY_URL/$COACH_NTFY_TOPIC/json"                         # watch the stream
```

If `COACH_NTFY_*` is unset, every push is a logged no-op — nothing else breaks.
