# Deploying ShrinkIt

This is a TanStack Start app built on Nitro, so the same codebase can target
either Netlify or Cloudflare Workers just by changing the build preset.

**Before deploying anywhere**, install and sanity-check locally:

```bash
bun install
bun run dev      # verify the new "Target size" tab works for an image and a PDF
bun run build    # make sure the production build succeeds
```

The new PDF target-size feature depends on `pdfjs-dist`, which was added to
`package.json` — `bun install` will pull it in.

## Option A — Netlify (recommended, simplest)

1. Push this repo to GitHub/GitLab/Bitbucket.
2. In Netlify: **Add new site → Import an existing project**, pick the repo.
3. A `netlify.toml` is already included at the repo root:
   ```toml
   [build]
     command = "bun run build"
     publish = ".output/public"

   [build.environment]
     NITRO_PRESET = "netlify"
   ```
   Netlify usually auto-detects Nitro projects too, but this file pins it
   explicitly so the build doesn't depend on auto-detection guessing right.
4. Make sure Netlify's build image has Bun available, or switch the build
   command to `npm install -g bun && bun run build` if it doesn't. If you'd
   rather not depend on Bun in CI at all, `npm run build` also works — just
   run `npm install` once locally to regenerate a `package-lock.json`.
5. Click **Deploy**. Netlify will show build logs — watch for the
   `pdf.worker.min.mjs` asset being emitted; that confirms the pdf.js worker
   bundled correctly.

## Option B — Cloudflare Workers

The project's Vite config already defaults Nitro's build target to
Cloudflare (see the comment in `vite.config.ts`), so no preset override is
needed.

1. `bun install`
2. `bun run build` — this produces a Cloudflare Worker-compatible output
   under `.output/` (via Nitro's `cloudflare` preset).
3. Install Wrangler if you don't have it: `npm install -g wrangler`
4. From the project root: `wrangler login`, then `wrangler deploy`
   (Wrangler will pick up the generated worker entry and static assets from
   the Nitro build output).
5. If you don't already have a `wrangler.toml`/`wrangler.jsonc` in the repo,
   Nitro's Cloudflare preset generates one during the build — check `.output/`
   after building. If Wrangler can't find it, run `wrangler deploy` from
   inside `.output/` or copy the generated config to the repo root.

## Notes on the new feature

- Everything still runs entirely in the browser — no files are uploaded to
  any server, matching the site's existing "100% private" promise.
- Images: target-size mode uses `browser-image-compression`'s built-in
  iterative quality/resolution search (`maxSizeMB`) to get under the target.
- PDFs: target-size mode rasterizes each page with `pdf.js` and re-encodes it
  as a JPEG at decreasing quality/DPI (via `src/lib/pdfTargetCompress.ts`)
  until the rebuilt PDF (via `pdf-lib`) is at/under the target. This trades
  selectable text for a hard size guarantee — the same approach most
  "compress PDF to X KB" tools use. The existing lighter-weight "Quality"
  mode for PDFs (object-stream optimization, text stays intact) is
  unchanged.
