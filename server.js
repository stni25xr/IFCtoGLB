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
const LOG_IFCCONVERT_STDERR = process.env.LOG_IFCCONVERT_STDERR === "true";
const ROOT_DIR = __dirname;
const UPLOAD_DIR = path.join(ROOT_DIR, "uploads");
const OUTPUT_DIR = path.join(ROOT_DIR, "outputs");
const FILE_TTL_MS = 1000 * 60 * 60 * 12;
const DEFAULT_CONVERT_TIMEOUT_MS = 1000 * 60 * 20;
const configuredTimeout = Number.parseInt(process.env.CONVERT_TIMEOUT_MS || "", 10);
const CONVERT_TIMEOUT_MS =
  Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : DEFAULT_CONVERT_TIMEOUT_MS;
const CONVERTER_CHECK_TTL_MS = 1000 * 60 * 5;
const CONVERSION_CACHE_FILE = path.join(OUTPUT_DIR, ".conversion-cache.json");
const conversionCache = new Map();
const inFlightByHash = new Map();
const converterStatus = {
  checkedAt: 0,
  value: null,
  pending: null
};

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

const getConverterAvailability = async ({ force = false } = {}) => {
  const now = Date.now();
  const fresh =
    converterStatus.value !== null && now - converterStatus.checkedAt < CONVERTER_CHECK_TTL_MS;

  if (!force && fresh) {
    return converterStatus.value;
  }

  if (converterStatus.pending) {
    return converterStatus.pending;
  }

  converterStatus.pending = canRunConverter()
    .then((value) => {
      converterStatus.value = value;
      converterStatus.checkedAt = Date.now();
      return value;
    })
    .finally(() => {
      converterStatus.pending = null;
    });

  return converterStatus.pending;
};

const computeFileHash = async (filePath) => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fssync.createReadStream(filePath);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
};

const loadConversionCache = async () => {
  try {
    const text = await fs.readFile(CONVERSION_CACHE_FILE, "utf8");
    const parsed = JSON.parse(text);
    for (const [hash, fileName] of Object.entries(parsed)) {
      if (typeof hash === "string" && typeof fileName === "string") {
        conversionCache.set(hash, fileName);
      }
    }
  } catch {
    // No cache file yet.
  }
};

const persistConversionCache = async () => {
  const payload = Object.fromEntries(conversionCache);
  await fs.writeFile(CONVERSION_CACHE_FILE, JSON.stringify(payload), "utf8");
};

const pruneConversionCache = async () => {
  let changed = false;
  for (const [hash, fileName] of conversionCache.entries()) {
    const resolvedPath = path.join(OUTPUT_DIR, fileName);
    if (!(await fileExists(resolvedPath))) {
      conversionCache.delete(hash);
      changed = true;
    }
  }

  if (changed) {
    await persistConversionCache();
  }
};

const runIfcConvert = async (inputPath, outputPath) => {
  return new Promise((resolve, reject) => {
    const proc = spawn(CONVERTER_BIN, [inputPath, outputPath]);
    let stderr = "";
    let settled = false;

    const finishError = (message) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      reject(new Error(message));
    };

    const timeoutId = setTimeout(() => {
      proc.kill("SIGKILL");
      finishError(
        `Conversion timed out after ${Math.ceil(CONVERT_TIMEOUT_MS / 60000)} minutes.`
      );
    }, CONVERT_TIMEOUT_MS);

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (LOG_IFCCONVERT_STDERR) {
        process.stdout.write(`[IfcConvert][stderr] ${chunk.toString()}`);
      }
    });

    proc.once("error", (error) => {
      finishError(error.message || "Failed to start IfcConvert.");
    });

    proc.once("close", (code) => {
      if (settled) {
        return;
      }
      clearTimeout(timeoutId);

      if (code === 0 && fssync.existsSync(outputPath)) {
        settled = true;
        resolve();
        return;
      }

      finishError(stderr.trim() || `IfcConvert exited with code ${code}.`);
    });
  });
};

const cleanupExpiredFiles = async (dirPath) => {
  const now = Date.now();
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
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
  const converterAvailable = await getConverterAvailability();
  res.json({
    ok: true,
    converter: CONVERTER_BIN,
    converterAvailable,
    convertTimeoutMs: CONVERT_TIMEOUT_MS
  });
});

app.post("/api/convert", upload.single("ifcFile"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No IFC file received." });
    return;
  }

  const startedAt = Date.now();
  const token = crypto.randomUUID().slice(0, 8);
  const inputPath = req.file.path;
  const requestTag = `${Date.now().toString(36)}-${token}`;
  const inputMb = (req.file.size / (1024 * 1024)).toFixed(2);
  let requestHash = "";

  console.log(
    `[convert:start] id=${requestTag} input=${req.file.originalname} sizeMb=${inputMb}`
  );

  try {
    const converterAvailable = await getConverterAvailability();
    if (!converterAvailable) {
      console.error(`[convert:error] id=${requestTag} reason=converter-not-available`);
      res.status(500).json({
        error: `Converter '${CONVERTER_BIN}' was not found. Install IfcConvert and ensure it is in PATH.`
      });
      return;
    }

    const fileHash = await computeFileHash(inputPath);
    requestHash = fileHash;
    const hashPrefix = fileHash.slice(0, 12);
    const cachedName = conversionCache.get(fileHash);

    if (cachedName) {
      const cachedPath = path.join(OUTPUT_DIR, cachedName);
      if (await fileExists(cachedPath)) {
        await fs.utimes(cachedPath, new Date(), new Date()).catch(() => {});
        const tookMs = Date.now() - startedAt;
        console.log(
          `[convert:cache-hit] id=${requestTag} hash=${hashPrefix} output=${cachedName} durationMs=${tookMs}`
        );
        res.json({
          ok: true,
          fileName: cachedName,
          downloadUrl: `/api/download/${encodeURIComponent(cachedName)}`,
          previewUrl: `/api/view/${encodeURIComponent(cachedName)}`,
          cached: true
        });
        return;
      }

      conversionCache.delete(fileHash);
      await persistConversionCache().catch(() => {});
    }

    if (inFlightByHash.has(fileHash)) {
      const sharedFileName = await inFlightByHash.get(fileHash);
      const tookMs = Date.now() - startedAt;
      console.log(
        `[convert:shared] id=${requestTag} hash=${hashPrefix} output=${sharedFileName} durationMs=${tookMs}`
      );
      res.json({
        ok: true,
        fileName: sharedFileName,
        downloadUrl: `/api/download/${encodeURIComponent(sharedFileName)}`,
        previewUrl: `/api/view/${encodeURIComponent(sharedFileName)}`,
        cached: true
      });
      return;
    }

    const outputFileName = `ifc-${hashPrefix}.glb`;
    const outputPath = path.join(OUTPUT_DIR, outputFileName);

    const convertPromise = (async () => {
      if (await fileExists(outputPath)) {
        conversionCache.set(fileHash, outputFileName);
        await persistConversionCache().catch(() => {});
        return outputFileName;
      }

      await runIfcConvert(inputPath, outputPath);
      conversionCache.set(fileHash, outputFileName);
      await persistConversionCache().catch(() => {});
      return outputFileName;
    })();

    inFlightByHash.set(fileHash, convertPromise);
    let completedFileName = "";
    try {
      completedFileName = await convertPromise;
    } finally {
      inFlightByHash.delete(fileHash);
    }

    const tookMs = Date.now() - startedAt;
    console.log(
      `[convert:done] id=${requestTag} hash=${hashPrefix} output=${completedFileName} durationMs=${tookMs}`
    );

    res.json({
      ok: true,
      fileName: completedFileName,
      downloadUrl: `/api/download/${encodeURIComponent(completedFileName)}`,
      previewUrl: `/api/view/${encodeURIComponent(completedFileName)}`,
      cached: false
    });
  } catch (error) {
    if (requestHash) {
      inFlightByHash.delete(requestHash);
    }
    const tookMs = Date.now() - startedAt;
    console.error(
      `[convert:error] id=${requestTag} durationMs=${tookMs} message="${error.message || "Conversion failed."}"`
    );
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
  await loadConversionCache();
  await pruneConversionCache();
  await getConverterAvailability({ force: true });

  setInterval(() => {
    Promise.all([
      cleanupExpiredFiles(UPLOAD_DIR),
      cleanupExpiredFiles(OUTPUT_DIR),
      pruneConversionCache(),
      getConverterAvailability({ force: true })
    ]).catch(() => {});
  }, 1000 * 60 * 30).unref();

  app.listen(PORT, () => {
    console.log(`IFCtoGLB app running on http://localhost:${PORT}`);
  });
};

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
