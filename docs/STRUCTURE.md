# CarVerse — codebase structure

Three top-level concerns, each in one place: **`public/`** is the frontend and
the deployable artifact, **`server/`** is everything that runs outside the
browser, **`scripts/`** is tooling. There is no build step — what is in
`public/` is what ships.

```
public/                        FRONTEND (also the deploy output)
  _headers                     Security + cache headers
  _redirects                   Pretty URLs (/cars -> /app/pages/cars.html)
  favicon.ico  apple-touch-icon.png  icon-512.png
  robots.txt
  app/
    index.html                 Home
    pages/                     cars, brands, compare, wishlist, contact,
                               car-details, admin-login
    admin/index.html           Admin dashboard shell
    assets/                    Images, and fonts/ for self-hosted faces
    models/                    3D models (.glb / .gltf)
    css/
      style.css                Public design system (themes, motion, layout)
      admin.css                Admin dashboard styles
    js/
      config/
        config.js              Firebase + Gemini keys — the only file to edit
        firebase.js            SDK bootstrap: app, auth, db
      components/
        layout.js              Header/footer, theme, esc/money/toast helpers
        car-card.js            Car card + carTitle/carCover helpers
      core/
        store.js               All Firestore reads/writes and media uploads
        catalog.js             Merged inventory, search, filter, availability
      data/
        brand-logos.js         Brand seed list + inline SVG logos
        fallback-cars.js       Demo listings used when Firestore is empty
        car-photos.js          Verified exterior/interior photo sets
      features/
        chatbot.js             Gemini assistant (uses live catalog as context)
        viewer3d.js            Three.js GLB/GLTF viewer (lazy loaded)
        animate.js             Page fade transitions
        motion.js              Reduced-motion + device capability policy
        motion-fx.js           Reveals, counters, tilt, scroll-words, parallax
        demo-admin.js          Local admin bypass when Firebase is unconfigured
      pages/                   One entry script per page

server/                        BACKEND
  worker.js                    Cloudflare Worker: serves public/, plus
                               POST /api/upload and GET /media/* backed by R2
  rules/
    firestore.rules            Database authorisation
    storage.rules              Legacy Firebase Storage rules (unused: media
                               now lives in R2)

scripts/
  serve.ps1                    Local preview on a random port
  deploy.ps1                   Deploy to Cloudflare

wrangler.toml                  Worker config: assets, R2 binding, vars
firebase.json                  Points at server/rules/*
serve.bat  deploy.bat          Double-clickable launchers for the scripts
docs/                          This documentation
```

## The API

One endpoint, served by the same Worker that serves the site.

| Method | Path          | Purpose                                              |
| ------ | ------------- | ---------------------------------------------------- |
| POST   | `/api/upload` | Admin media upload to R2. Requires a Firebase ID token in `Authorization: Bearer …`; the uid must be in `ADMIN_UIDS`. Validates folder, size (60 MB) and content type. |
| GET    | `/media/*`    | Serves an R2 object with its stored cache headers.    |
| \*     | everything    | Falls through to the static assets in `public/`.      |

## The database

Firestore. Collections, and who may touch them (see
[`server/rules/firestore.rules`](../server/rules/firestore.rules)):

| Collection          | Read           | Write                          |
| ------------------- | -------------- | ------------------------------ |
| `cars`, `brands`, `settings` | anyone | admins only            |
| `customerInquiries` | admins         | anyone may create, with field validation |
| `chatHistory`       | admins         | anyone may create        |
| `wishlist`, `compare` | anyone       | created/removed by the owning visitor |
| `admins`            | signed-in      | console only             |

Media lives in Cloudflare R2, not Firestore — documents store the `/media/…`
path only.

## Layer rules

1. **Pages never talk to Firebase directly** — they import from `core/store.js`
   or `core/catalog.js`.
2. **`core/` never imports from `pages/`.** Data flows one way:
   `config → core → (data, features, components) → pages`.
3. **Keys live in one file**: `js/config/config.js`.
4. Adding a page = new HTML in `app/pages/` + one entry script in `js/pages/`.
