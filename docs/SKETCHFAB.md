# Sketchfab 3D models

Admin → edit car → **3D model** has two options:

1. **Upload 3D Model** — a GLB/glTF file, stored in R2 under `3d-models/`.
   (Uploads used to fail as "unsupported" because browsers send `.glb` with an
   empty type; the Worker now takes the type from the extension for this
   folder only.)
2. **Import from Sketchfab** — paste a model link
   (`https://sketchfab.com/3d-models/name-<uid>` or `https://sketchfab.com/models/<uid>`).

Only Sketchfab's official API is used. No page is scraped.

| Step | Call | Notes |
|---|---|---|
| Preview | `POST /api/admin/sketchfab/preview { url }` → `GET api.sketchfab.com/v3/models/{uid}` | title, author, thumbnail, license, downloadable |
| Import | `POST /api/admin/sketchfab/import { url, mode: "download" }` → `GET …/models/{uid}/download` with `Authorization: Token …` | only when Sketchfab says `isDownloadable` |
| Embed | `POST /api/admin/sketchfab/import { url, mode: "embed" }` | no download; official viewer `https://sketchfab.com/models/{uid}/embed` |

Both routes are admin-only (same `adminUser` check as uploads). The Worker
re-reads the metadata itself; the browser only supplies the link, which must
parse to a 32-hex Sketchfab UID.

## Download rules

- Needs the Worker secret `SKETCHFAB_API_TOKEN` (a Sketchfab API token):
  `npx wrangler secret put SKETCHFAB_API_TOKEN`. Without it, only the embed is
  offered. The token is never sent to the browser or stored in Firestore.
- A model Sketchfab marks as not downloadable is never downloaded (409); the
  admin is offered the embed.
- Only the URL returned by the Download API is fetched, and only if it is
  https on `sketchfab-prod-media.s3.amazonaws.com` or a `*.sketchfab.com`
  host, with no port or credentials, and with redirects refused. There is no
  general URL proxy.
- GLB is preferred; otherwise the glTF zip is unpacked in the Worker. Limits:
  60 MB download, 120 MB unpacked, 300 files, 60 s. Only `.gltf .bin .png
  .jpg .jpeg .webp .ktx2` with safe relative names are kept; zip64, encrypted
  and unknown compression are refused.
- Files go to R2 at `3d-models/sketchfab/{uid}/{timestamp}/…`.

## What is saved on the car

Existing fields are reused; one optional field is added.

| Field | Upload | Sketchfab download | Sketchfab embed |
|---|---|---|---|
| `modelUrl` | `/media/3d-models/…` | `/media/3d-models/sketchfab/…/model.glb` or `…/scene.gltf` | `https://sketchfab.com/models/{uid}/embed` |
| `modelPath` | R2 key | R2 prefix | `null` |
| `modelSource` | `null` | `{ type: "sketchfab-download", uid, title, author, authorUrl, license, licenseUrl, viewerUrl, format, files, importedAt }` | `{ type: "sketchfab-embed", …, embedUrl }` |

Nothing is written until the admin saves the car. Uploading, importing or
removing replaces the previous model and its attribution. The car page shows
the Sketchfab viewer (only for an exact `sketchfab.com/models/{uid}/embed`
URL) or the built-in Three.js viewer, with the author/license credit.
