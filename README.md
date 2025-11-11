# Flipbook PDF Experience

A full-stack flipbook viewer built with Node.js and React. The application accepts PDF uploads, rasterizes the pages with `pdfjs-dist`, and presents them inside a highly animated flipbook with realistic lighting and page turns.

## Architecture at a glance

The repository is split into two packages:

| Folder  | Description |
|---------|-------------|
| `server/` | Express application that exposes a PDF upload API, persists uploads on disk temporarily, and serves the built client bundle in production. |
| `client/` | Vite + React single-page application that renders uploaded PDFs, animates page turns, and falls back to local parsing when the backend is unavailable. |

There is **no Docker configuration**. Both services run directly on your machine using Node.js, making this a self-contained app once dependencies are installed.

## Quick start

1. **Install prerequisites**
   - Node.js 18 or newer
   - npm 9 or newer

2. **Install dependencies**
   ```bash
   cd server && npm install
   cd ../client && npm install
   ```

3. **Run the development servers**
   Open two terminals:
   ```bash
   # Terminal 1 - start the Express API on http://localhost:3001
   cd server
   npm run dev
   ```
   ```bash
   # Terminal 2 - start the Vite dev server on http://localhost:5173
   cd client
   npm run dev
   ```
   The Vite configuration proxies `/api` requests to the Express app so PDF uploads work without additional setup.

4. **Visit the flipbook**
   Browse to the Vite URL (shown in the console, typically `http://localhost:5173`) and upload a PDF to see it rendered as an animated book.

## Production build & serving

To build the client and serve it from the Express server:

```bash
# Build the React bundle
cd client
npm run build

# Serve the bundle and API
cd ../server
npm start
```

The production server listens on port `3001` by default and serves both the API (`/api/upload`) and the static assets from `client/dist`.

## Configuration

The app runs with sensible defaults, but you can customize behaviour through environment variables when launching the server:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT`   | `3001`  | Port for the Express server. |
| `UPLOAD_LIMIT_MB` | `25` | Maximum PDF upload size accepted by the API (in MB). |
| `DOCUMENT_TTL_MINUTES` | `30` | Number of minutes to retain uploaded PDFs on disk before automatic cleanup. |

Create a `.env` file inside `server/` if you want to persist custom values.

For client-side tweaks, create a `.env` file in `client/` and set Vite environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `VITE_PDF_CMAP_URL` | _unset_ | Base URL where pdf.js CMaps are hosted (for example, `/cmaps/` or a CDN URL). When provided, the React client automatically points pdf.js at this directory and enables advanced font rendering. |

## API surface

| Method | Endpoint       | Description |
|--------|----------------|-------------|
| `POST` | `/api/upload`  | Accepts a single PDF file via multipart form-data (`file` field). Stores it on disk temporarily and returns a document identifier plus the expiry timestamp. |
| `GET`  | `/api/documents/:id` | Streams the previously uploaded PDF back to the client using the identifier returned from `/api/upload`. |
| `DELETE` | `/api/documents/:id` | Removes the uploaded PDF ahead of the automatic expiry window. |
| `GET`  | `/api/health`  | Lightweight health check used by deployment monitors and local sanity checks. |

## Temporary storage lifecycle

- Uploaded PDFs are written to `server/uploads/`, which is git-ignored and created on demand when the server boots.
- The `/api/upload` response includes an `expiresAt` timestamp based on `DOCUMENT_TTL_MINUTES` (default 30 minutes).
- Clients fetch the stored PDF via `/api/documents/:id` and can proactively delete it with `DELETE /api/documents/:id` when they no longer need it.
- Expired PDFs are removed automatically by the server, and the React app displays an expiry reminder whenever a server-backed document is loaded.

## Front-end behaviour

- Rasterizes PDF pages using `pdfjs-dist` within a dedicated worker for responsive rendering.
- Caches each page as a data URL to allow smooth navigation and quick backward/forward flips.
- Provides on-screen controls and keyboard navigation (left/right arrows) for paging.
- Implements custom easing, perspective transforms, shadows, and highlights to emulate realistic paper turns.
- Gracefully degrades to local PDF parsing when the backend upload endpoint is not reachable and cleans up server-side documents when you clear the viewer or close the tab.
- Lets readers toggle immersive page-turn audio and swap between multiple paper textures without reloading the document.
- Can optionally load pdf.js **Character Maps (CMaps)** when you supply a hosted directory via `VITE_PDF_CMAP_URL`, enabling advanced font rendering without increasing the default bundle size.

## Customising the reading experience

Once a PDF is loaded you can tailor the flipbook without re-uploading:

- **Page textures** – Pick from smooth matte, linen weave, recycled fiber, or canvas grain overlays. These apply subtle blend-mode layers that sit on top of the rasterised PDF imagery to emulate different paper stocks.
- **Page-turn audio** – Enable or disable the spatial “whoosh” generated with the Web Audio API when navigating forward or backward. Audio is synthesised on demand so no additional assets are downloaded.

## Development scripts

### Server scripts
- `npm run dev` – Start the Express server with hot reloading via `nodemon`.
- `npm start` – Launch the production Express server.

### Client scripts
- `npm run dev` – Start the Vite development server.
- `npm run build` – Create a production-ready build in `client/dist`.
- `npm run preview` – Serve the built assets locally for smoke testing.

## Project structure

```
client/         React + Vite front end
  src/
    components/
      Flipbook.tsx   # Main flipbook component
      Flipbook.css   # Styles and animation keyframes
    App.tsx          # App shell orchestrating uploads and viewer state
server/         Express API and static asset host
  src/index.js       # Server entry point
```

## Next steps for production readiness

This codebase currently represents an MVP. To mature it into a production-ready product, consider adding:

- Persistent storage and streaming uploads for large PDFs.
- Authentication, rate limiting, and antivirus scanning for file uploads.
- Automated tests, linting, and CI/CD pipelines.
- Observability tooling (structured logging, metrics, tracing).
- Deployment automation or containerization (Docker/Kubernetes) as needed.

## What are CMaps?

`pdfjs-dist` occasionally needs **Character Maps (CMaps)** to correctly render Type0 fonts (commonly found in Asian language PDFs or documents generated from specialised publishing systems). A CMap describes how a font’s encoded glyph identifiers map to actual Unicode characters.

The project no longer bundles these assets by default to keep the repository lean. If you want to support documents that depend on CMaps:

1. Download the official CMaps package from the [pdf.js releases](https://github.com/mozilla/pdf.js/releases) (look for the `pdfjs-x.x.x-dist.zip` archive and extract the `web/cmaps/` folder).
2. Host the extracted directory somewhere your client can reach (for example, copy it into `client/public/cmaps/` in your deployment or upload it to a CDN).
3. Set `VITE_PDF_CMAP_URL` to the public URL of that directory (e.g., `/cmaps/` if you placed them in the client `public/` folder).

With the environment variable in place, the React viewer automatically instructs pdf.js to load CMaps from the provided location, unlocking full multilingual rendering fidelity.
