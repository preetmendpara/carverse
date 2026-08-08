# Deploying CarVerse to Cloudflare Pages

The deployable artifact is the `public/` folder. There is no build command.

## Option A — Git integration (auto-deploy on push)

1. Push this repo to GitHub/GitLab.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Settings:
   - **Framework preset:** None
   - **Build command:** *(leave empty)*
   - **Build output directory:** `public`
4. **Save and Deploy** → live at `https://<project>.pages.dev`.

Every push to the production branch redeploys automatically.

## Option B — Wrangler CLI (direct upload)

```bash
npm i -g wrangler
wrangler login
wrangler pages deploy public --project-name carverse
```

A ready config lives at `deploy/cloudflare/wrangler.toml`.

## Post-deploy checklist

1. **Firebase Authentication → Settings → Authorized domains**: add
   `<project>.pages.dev` and your custom domain, or admin login is rejected.
2. **Firebase Storage → CORS**: allow your Pages origin so admin image uploads work.
3. **Google AI Studio key**: restrict it by HTTP referrer to your Pages/custom
   domain — the key is public in the browser bundle.
4. Custom domain: Pages project → **Custom domains → Set up a domain**.

## What the config files do

- `public/_redirects` — `/` → `/app/`, plus pretty URLs like `/cars`, `/admin`.
- `public/_headers` — nosniff, referrer policy, frame options, cache rules for
  css/js/assets/models.

## Still want Firebase Hosting?

`firebase.json` already points at `public/app`, so `firebase deploy` keeps working.
Cloudflare Pages and Firebase Hosting can run side by side.