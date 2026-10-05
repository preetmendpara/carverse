# 3D models: uploads and Sketchfab embeds

CarVerse shows a car's 3D model in one of two ways. It **embeds** Sketchfab
models with Sketchfab's own viewer; it never downloads, copies, proxies or
scrapes Sketchfab models, and it calls no Sketchfab API (no token is needed).

Admin → edit car → **3D model**:

| Option | What the admin gives | What is stored on the car |
|---|---|---|
| Upload 3D Model | a GLB/glTF file (`/api/upload`, stored in R2 under `3d-models/`) | `modelUrl` `/media/3d-models/…`, `modelPath` R2 key, `modelSource` `null` |
| Paste Sketchfab Embed Code | the `<iframe>` snippet from Sketchfab's "Embed" button | `modelUrl` `https://sketchfab.com/models/{uid}/embed`, `modelPath` `null`, `modelSource` below |
| Paste Sketchfab URL | `https://sketchfab.com/3d-models/{name}-{uid}` | same as the embed code |

```
modelSource = { type: "sketchfab-embed", embedUrl, sourceUrl, attribution }
```

**Preview** shows the result in a sandboxed Sketchfab viewer. **Save** writes
it to the car straight away (or, for a car not saved yet, with the car); this
is the same admin-only Firestore write as every other car edit. Upload, embed
and **Remove** each replace the previous model.

## Validation (`public/app/js/core/model-source.js`)

- Only `https://sketchfab.com` / `https://www.sketchfab.com` (host is
  case-insensitive), no port, no credentials. `javascript:`, `data:`, `blob:`,
  `http:` and every other host are rejected.
- Embed code is read as text, never parsed into the page or executed. It must
  contain exactly one `<iframe>` whose `src` is a Sketchfab model embed
  (`/models/{uid}/embed`); any other iframe is rejected.
- The 32-hex model UID is extracted and the embed URL is rebuilt from it
  (`https://sketchfab.com/models/{uid}/embed`), dropping any query string.
  Only that URL is stored, never the pasted HTML.
- The credit line Sketchfab includes in its embed code is kept as plain text
  (tags and `<`/`>` removed, 200 characters max). For a pasted URL, the admin
  can type the credit.
- The car page iframes a model only when `modelUrl` is exactly
  `https://sketchfab.com/models/{uid}/embed`, with
  `sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"`,
  and shows the credit with a "View on Sketchfab" link underneath. A local
  model must be a path on this site (`/media/…`) and opens in the built-in
  Three.js viewer. No model: the 3D section stays hidden.
- Uploads: browsers send `.glb`/`.gltf` with an empty type, so for the
  `3d-models` folder the Worker takes the type from the extension.
