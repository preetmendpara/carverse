# Running CarVerse on localhost

The site is plain HTML/CSS/JS — no build step required.

## Option A — VS Code Live Server (recommended)

1. Install the **Live Server** extension.
2. Right-click `public/app/index.html` → **Open with Live Server**.
3. The site opens at `http://127.0.0.1:5500/public/app/index.html`.

## Option B — any static server from the repo root

```bash
npx serve public        # then open http://localhost:3000/app/
# or
python -m http.server 8000 --directory public
```

## Option C — Cloudflare Pages dev (same runtime as production)

```bash
npx wrangler pages dev public
```

This is the only local option that also applies `_redirects` and `_headers`,
so `http://localhost:8788/` correctly lands on `/app/`.

## Before the first run

Fill in `public/app/js/config/config.js`:

- `firebaseConfig` — from Firebase console → Project settings → Your apps → Web app
- `ADMIN_UIDS` — the UID(s) allowed into the admin dashboard
- `GEMINI_API_KEY` — Google AI Studio key for the chatbot

Add `localhost` and `127.0.0.1` under Firebase Authentication →
Settings → **Authorized domains**, otherwise admin login fails locally.

Admin dashboard: `/app/pages/admin-login.html` → `/app/admin/`.