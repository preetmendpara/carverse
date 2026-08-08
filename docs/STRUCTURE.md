# CarVerse — codebase structure

The whole website is a static, framework-free app. Everything shipped to the
browser lives under `public/`, so the same folder works for VS Code Live Server,
Cloudflare Pages and Firebase Hosting.

```
public/
  _headers                 Cloudflare Pages security + cache headers
  _redirects               Pretty URLs (/cars -> /app/pages/cars.html)
  favicon.ico  robots.txt
  app/
    index.html             Home page
    pages/                 cars, brands, compare, wishlist, contact, car-details, admin-login
    admin/index.html       Admin dashboard shell
    css/
      style.css            Public site styles (black & white design system)
      admin.css            Admin dashboard styles
    firebase/
      config.js            Firebase + Gemini keys (edit this file only)
      firebase.js          SDK bootstrap: app, auth, db, storage
    components/
      layout.js            Header/footer, esc/money/toast helpers
      car-card.js          Reusable car card + carTitle/carCover helpers
    js/
      core/
        store.js           All Firestore/Storage reads & writes (single source of truth)
        catalog.js         Merged inventory, search, filtering, availability
      data/
        brand-logos.js     Brand seed list + inline SVG logos
        fallback-cars.js   Demo listings used when Firestore is empty
        car-photos.js      Verified exterior/interior photo sets
      features/
        chatbot.js         Gemini assistant (uses live catalog as context)
        viewer3d.js        Three.js GLB/GLTF viewer (lazy loaded)
        animate.js         Page fade transitions + button micro-interactions
        motion.js          Reduced-motion + auto performance mode
        motion-fx.js       Scroll reveals, staggered grids, scroll-word effect
        demo-admin.js      Local admin bypass when Firebase is unconfigured
      pages/               One entry script per page (home, cars, brands, …, admin)
    assets/                Static images
    models/                3D car models (.glb / .gltf)
    uploads/               Local placeholder for uploaded media
deploy/cloudflare/wrangler.toml
docs/                      This documentation
firebase.json  firestore.rules  storage.rules
```

## Layer rules

1. **Pages never talk to Firebase directly** — they import from `js/core/store.js`
   or `js/core/catalog.js`.
2. **`core/` never imports from `pages/`** — data flows one way:
   `firebase → core → (data, features) → pages`.
3. **Keys live in one file**: `public/app/firebase/config.js`.
4. Add a new page = new HTML in `app/pages/` + one entry script in `app/js/pages/`.