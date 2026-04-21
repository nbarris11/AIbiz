# Cloudflare Tunnel Setup

One-time setup to expose your local CRM at `app.sidecaradvisory.com`.
After setup, you start everything with a single command.

---

## Phase 1 — Move DNS to Cloudflare (10 min)

Your domain is currently on Namecheap's nameservers. Cloudflare Tunnel
requires your domain to be managed by Cloudflare. The public Vercel site
keeps working — Cloudflare just takes over DNS.

1. **Sign up for Cloudflare** (free): https://dash.cloudflare.com/sign-up
2. **Add a Site** → enter `sidecaradvisory.com` → choose the **Free plan**
3. Cloudflare will scan your existing DNS and import the records (Vercel
   records will come across automatically — leave them as "DNS only" /
   grey cloud so Vercel keeps serving the main site)
4. Cloudflare gives you two nameservers (something like
   `karl.ns.cloudflare.com` and `lola.ns.cloudflare.com`) — **copy them**
5. **Go to Namecheap** → Domain List → Manage `sidecaradvisory.com` →
   Nameservers → switch from "Namecheap BasicDNS" to "Custom DNS" → paste
   the two Cloudflare nameservers → Save
6. Wait 5–30 minutes for DNS to propagate. Cloudflare will email you
   when the site is active. The Vercel site stays up the whole time.

---

## Phase 2 — Install and authenticate cloudflared (5 min)

Run these in Terminal:

```bash
# Install
brew install cloudflared

# Login (opens your browser → pick sidecaradvisory.com → Authorize)
cloudflared tunnel login
```

---

## Phase 3 — Create the tunnel (2 min)

```bash
cloudflared tunnel create sidecar-app
```

This prints a **Tunnel UUID** — copy it.

Then open `scripts/cloudflared-config.yml` from this project. Replace
both `<TUNNEL_ID>` placeholders with your actual UUID, then copy the
file into place:

```bash
mkdir -p ~/.cloudflared
cp scripts/cloudflared-config.yml ~/.cloudflared/config.yml
```

Route DNS so `app.sidecaradvisory.com` points to the tunnel:

```bash
cloudflared tunnel route dns sidecar-app app.sidecaradvisory.com
```

---

## Phase 4 — Run it

From the project root:

```bash
./scripts/start.sh
```

This starts both `node server.js` and the Cloudflare Tunnel. Press
Ctrl+C to stop both.

Visit:
- **CRM (you):** https://app.sidecaradvisory.com/internal
- **Client portal:** https://app.sidecaradvisory.com/portal

The site works anywhere with internet — your phone, clients' devices,
etc. — as long as your laptop is on and the script is running. When
your laptop sleeps or the script stops, the URL returns an error; the
public `sidecaradvisory.com` site is unaffected.

---

## Making it start automatically (optional)

If you want the tunnel + server to start whenever your Mac boots up,
you can install cloudflared as a macOS launchd service later. For now,
just running `./scripts/start.sh` from Terminal is fine.
