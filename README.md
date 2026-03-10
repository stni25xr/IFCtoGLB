# IFC to GLB Converter

Modern web application to upload IFC files and convert them to GLB using `IfcConvert`.

## Features

- Modern drag-and-drop upload UI
- Backend conversion endpoint (`/api/convert`)
- Download endpoint for generated GLB (`/api/download/:fileName`)
- Inline GLB preview endpoint (`/api/view/:fileName`)
- Health check endpoint (`/api/health`)
- Temporary file cleanup

## Architecture

- Frontend: static files in [`public/`](./public) (also reachable from repo root for GitHub Pages)
- Backend: Node/Express service in [`server.js`](./server.js)
- Converter: `IfcConvert` binary (server-side)

## Requirements

- Node.js 18+
- `IfcConvert` installed and available in `PATH`

If `IfcConvert` is installed elsewhere, set:

```bash
export IFC_CONVERTER_BIN="/path/to/IfcConvert"
```

## Run locally

```bash
npm install
npm run start
```

Open: [http://localhost:3000](http://localhost:3000)

## Publish frontend on GitHub Pages

1. In GitHub repository settings, open **Pages**.
2. Set source to:
   - **Branch:** `main`
   - **Folder:** `/ (root)`
3. Save.
4. Open: `https://stni25xr.github.io/IFCtoGLB/`

The root [`index.html`](./index.html) redirects to the actual app page in [`public/index.html`](./public/index.html).

## Deploy backend on Render (Docker)

This repo includes:

- [`Dockerfile`](./Dockerfile): installs Node + IfcConvert + app
- [`render.yaml`](./render.yaml): Render blueprint

Steps:

1. In Render, create a new **Blueprint** service from this GitHub repo.
2. Deploy using `render.yaml`.
3. Copy your backend URL after deploy, for example:
   - `https://ifctoglb-backend.onrender.com`
4. Open the frontend (`https://stni25xr.github.io/IFCtoGLB/`).
5. In the app, set **Backend API URL** to your Render URL and click **Save**.

After this, uploads/conversion/download/preview run against the deployed backend.

## API

### `POST /api/convert`

Multipart form upload:

- field name: `ifcFile`
- accepted extension: `.ifc`
- max size: `1 GB`

Response:

```json
{
  "ok": true,
  "fileName": "example-a1b2c3d4.glb",
  "downloadUrl": "/api/download/example-a1b2c3d4.glb",
  "previewUrl": "/api/view/example-a1b2c3d4.glb"
}
```

### `GET /api/download/:fileName`

Downloads generated `.glb` file.

### `GET /api/view/:fileName`

Serves generated `.glb` inline for browser preview.

### `GET /api/health`

Checks if backend is running and if `IfcConvert` is available.
