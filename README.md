# IFC to GLB Converter

Modern web application to upload IFC files and convert them to GLB using `IfcConvert`.

## Features

- Modern drag-and-drop upload UI
- Backend conversion endpoint (`/api/convert`)
- Download endpoint for generated GLB (`/api/download/:fileName`)
- Inline GLB preview endpoint (`/api/view/:fileName`)
- Health check endpoint (`/api/health`)
- Temporary file cleanup

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
