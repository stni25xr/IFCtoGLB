const express = require("express");
const multer = require("multer");
const fs = require("fs/promises");
const fssync = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;
const CONVERTER_BIN = process.env.IFC_CONVERTER_BIN || "IfcConvert";
const ROOT_DIR = __dirname;
const UPLOAD_DIR = path.join(ROOT_DIR, "uploads");
const OUTPUT_DIR = path.join(ROOT_DIR, "outputs");
const FILE_TTL_MS = 1000 * 60 * 60 * 12;

const ensureDir = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
};

const sanitizeBaseName = (name) => {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "model"
  );
};

const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const getResolvedGlbPath = (requestedName) => {
  const safeName = path.basename(requestedName || "");
  if (safeName !== requestedName || path.extname(safeName).toLowerCase() !== ".glb") {
    return null;
  }

  return {
    safeName,
    resolvedPath: path.join(OUTPUT_DIR, safeName)
  };
};

const canRunConverter = async () => {
  return new Promise((resolve) => {
    const proc = spawn(CONVERTER_BIN, ["--version"]);
    proc.once("error", () => resolve(false));
    proc.once("close", (code) => resolve(code === 0 || code === 1));
  });
};

const runIfcConvert = async (inputPath, outputPath) => {
  return new Promise((resolve, reject) => {
    const proc = spawn(CONVERTER_BIN, [inputPath, outputPath]);
    let stderr = "";

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.once("error", (error) => {
      reject(error);
    });

    proc.once("close", (code) => {
      if (code === 0 && fssync.existsSync(outputPath)) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `IfcConvert exited with code ${code}.`));
    });
  });
};

const cleanupExpiredFiles = async (dirPath) => {
  const now = Date.now();
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const fullPath = path.join(dirPath, entry.name);
        const stats = await fs.stat(fullPath);
        if (now - stats.mtimeMs > FILE_TTL_MS) {
          await fs.unlink(fullPath);
        }
      })
  );
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const baseName = sanitizeBaseName(path.parse(file.originalname).name);
    cb(null, `${baseName}-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 1024 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    const isIfc = path.extname(file.originalname).toLowerCase() === ".ifc";
    if (!isIfc) {
      cb(new Error("Only IFC files are accepted."));
      return;
    }
    cb(null, true);
  }
});

app.use(express.json());

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
});

app.use(express.static(path.join(ROOT_DIR, "public")));

app.get("/api/health", async (_req, res) => {
  const converterAvailable = await canRunConverter();
  res.json({
    ok: true,
    converter: CONVERTER_BIN,
    converterAvailable
  });
});

app.post("/api/convert", upload.single("ifcFile"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No IFC file received." });
    return;
  }

  const originalBase = sanitizeBaseName(path.parse(req.file.originalname).name);
  const token = crypto.randomUUID().slice(0, 8);
  const outputFileName = `${originalBase}-${token}.glb`;
  const outputPath = path.join(OUTPUT_DIR, outputFileName);
  const inputPath = req.file.path;

  try {
    const converterAvailable = await canRunConverter();
    if (!converterAvailable) {
      res.status(500).json({
        error: `Converter '${CONVERTER_BIN}' was not found. Install IfcConvert and ensure it is in PATH.`
      });
      return;
    }

    await runIfcConvert(inputPath, outputPath);

    res.json({
      ok: true,
      fileName: outputFileName,
      downloadUrl: `/api/download/${encodeURIComponent(outputFileName)}`,
      previewUrl: `/api/view/${encodeURIComponent(outputFileName)}`
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Conversion failed."
    });
  } finally {
    fs.unlink(inputPath).catch(() => {});
  }
});

app.get("/api/download/:fileName", async (req, res) => {
  const parsed = getResolvedGlbPath(req.params.fileName);
  if (!parsed) {
    res.status(400).json({ error: "Invalid file name." });
    return;
  }

  const { safeName, resolvedPath } = parsed;

  if (!(await fileExists(resolvedPath))) {
    res.status(404).json({ error: "File not found." });
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.download(resolvedPath, safeName);
});

app.get("/api/view/:fileName", async (req, res) => {
  const parsed = getResolvedGlbPath(req.params.fileName);
  if (!parsed) {
    res.status(400).json({ error: "Invalid file name." });
    return;
  }

  const { resolvedPath } = parsed;
  if (!(await fileExists(resolvedPath))) {
    res.status(404).json({ error: "File not found." });
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "model/gltf-binary");
  res.sendFile(resolvedPath);
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "File is too large (max 1 GB)." });
    return;
  }

  res.status(400).json({ error: err.message || "Unexpected request error." });
});

const bootstrap = async () => {
  await ensureDir(UPLOAD_DIR);
  await ensureDir(OUTPUT_DIR);

  setInterval(() => {
    Promise.all([cleanupExpiredFiles(UPLOAD_DIR), cleanupExpiredFiles(OUTPUT_DIR)]).catch(
      () => {}
    );
  }, 1000 * 60 * 30).unref();

  app.listen(PORT, () => {
    console.log(`IFCtoGLB app running on http://localhost:${PORT}`);
  });
};

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
