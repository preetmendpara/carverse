# CarVerse

A car marketplace with verified listings, 3D walkarounds and an AI assistant
that answers from live inventory. Static frontend, Cloudflare Worker backend,
Firestore database. No build step.

## Run it

```bash
.\serve.bat      # local preview, opens a browser
.\deploy.bat     # deploy to Cloudflare
```

## Layout

| Path       | What                                                        |
| ---------- | ----------------------------------------------------------- |
| `public/`  | Frontend, and the exact artifact that gets deployed          |
| `server/`  | Cloudflare Worker (`/api/upload`, `/media/*`) and DB rules   |
| `scripts/` | Serve and deploy scripts                                     |
| `docs/`    | Structure, local development, deployment                     |

Full map: [docs/STRUCTURE.md](docs/STRUCTURE.md)

## Configuration

Keys live in one file: `public/app/js/config/config.js` (Firebase web config,
Gemini API key, admin UIDs). The Worker's own vars are in `wrangler.toml`.

## Stack

Vanilla ES modules · Firestore · Cloudflare Workers + R2 · Gemini · Three.js
