const form = document.getElementById("convert-form");
const fileInput = document.getElementById("ifc-file");
const dropzone = document.getElementById("dropzone");
const selectedFile = document.getElementById("selected-file");
const convertBtn = document.getElementById("convert-btn");
const progressCard = document.getElementById("progress-card");
const progressFill = document.getElementById("progress-fill");
const progressValue = document.getElementById("progress-value");
const progressLabel = document.getElementById("progress-label");
const progressElapsed = document.getElementById("progress-elapsed");
const cancelConvertBtn = document.getElementById("cancel-convert-btn");
const resultCard = document.getElementById("result-card");
const resultTitle = document.getElementById("result-title");
const resultText = document.getElementById("result-text");
const downloadLink = document.getElementById("download-link");
const healthPill = document.getElementById("health-pill");
const glbViewer = document.getElementById("glb-viewer");
const viewerPlaceholder = document.getElementById("viewer-placeholder");
const resetViewBtn = document.getElementById("reset-view-btn");
const apiBaseInput = document.getElementById("api-base-input");
const saveApiBaseBtn = document.getElementById("save-api-base-btn");

let selectedIfcFile = null;
let progressTimer = null;
let elapsedTimer = null;
let progressStartedAt = 0;
let currentPreviewUrl = "";
let currentAbortController = null;
let requestTimedOut = false;
let apiBase = (window.APP_API_BASE || "").trim().replace(/\/+$/, "");
const CLIENT_CONVERT_TIMEOUT_MS = 1000 * 60 * 12;

const getApiUrl = (path) => {
  return apiBase ? `${apiBase}${path}` : path;
};

const withApiBase = (url) => {
  if (!url) {
    return "";
  }
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  return getApiUrl(url);
};

const formatElapsed = (ms) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
};

const updateElapsed = () => {
  if (!progressElapsed || !progressStartedAt) {
    return;
  }
  progressElapsed.textContent = `Elapsed: ${formatElapsed(Date.now() - progressStartedAt)}`;
};

const setProgress = (value, message, state = "normal") => {
  const bounded = Math.max(0, Math.min(100, value));
  progressFill.style.width = `${bounded}%`;
  if (state === "waiting") {
    progressFill.classList.add("waiting");
    progressValue.textContent = "Running...";
  } else {
    progressFill.classList.remove("waiting");
    progressValue.textContent = `${Math.round(bounded)}%`;
  }
  if (message) {
    progressLabel.textContent = message;
  }
};

const setViewerState = ({ previewUrl, message }) => {
  if (!glbViewer || !viewerPlaceholder) {
    return;
  }

  if (previewUrl) {
    currentPreviewUrl = `${previewUrl}${previewUrl.includes("?") ? "&" : "?"}v=${Date.now()}`;
    glbViewer.src = currentPreviewUrl;
    viewerPlaceholder.classList.add("hidden");
    return;
  }

  currentPreviewUrl = "";
  glbViewer.removeAttribute("src");
  viewerPlaceholder.textContent = message || "Convert a file to preview your GLB model here.";
  viewerPlaceholder.classList.remove("hidden");
};

const showResult = ({ ok, title, text, downloadUrl, fileName }) => {
  resultCard.classList.remove("hidden");
  resultTitle.textContent = title;
  resultText.textContent = text;

  if (ok && downloadUrl) {
    downloadLink.classList.remove("hidden");
    downloadLink.href = withApiBase(downloadUrl);
    downloadLink.download = fileName || "converted.glb";
  } else {
    downloadLink.classList.add("hidden");
    downloadLink.removeAttribute("href");
  }
};

const setSelectedFile = (file) => {
  selectedIfcFile = file || null;
  selectedFile.textContent = selectedIfcFile ? selectedIfcFile.name : "No file selected";
};

const isIfcFile = (file) => {
  return Boolean(file && file.name.toLowerCase().endsWith(".ifc"));
};

const clearProgressTimers = () => {
  clearInterval(progressTimer);
  clearInterval(elapsedTimer);
};

const startConversionProgress = () => {
  clearProgressTimers();
  progressStartedAt = Date.now();
  progressCard.classList.remove("hidden");
  setProgress(3, "Uploading IFC...");
  updateElapsed();

  if (cancelConvertBtn) {
    cancelConvertBtn.disabled = false;
  }

  elapsedTimer = setInterval(() => {
    updateElapsed();
  }, 1000);

  progressTimer = setInterval(() => {
    const current = Number.parseFloat(progressFill.style.width) || 0;
    if (current < 92) {
      const delta =
        current < 50 ? 6 + Math.random() * 3 : current < 80 ? 1.8 + Math.random() * 1.4 : 0.4;
      setProgress(Math.min(92, current + delta), "Converting model...");
      return;
    }

    setProgress(96, "IfcConvert is still processing this model...", "waiting");
  }, 900);
};

const stopConversionProgress = (finalValue, message) => {
  clearProgressTimers();
  updateElapsed();
  setProgress(finalValue, message);
  progressFill.classList.remove("waiting");
  if (cancelConvertBtn) {
    cancelConvertBtn.disabled = true;
  }
};

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("drag-over");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("drag-over");
});

dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("drag-over");

  const file = event.dataTransfer.files[0];
  if (!isIfcFile(file)) {
    showResult({
      ok: false,
      title: "Unsupported file",
      text: "Please upload an IFC file (.ifc)."
    });
    return;
  }

  fileInput.files = event.dataTransfer.files;
  setSelectedFile(file);
});

fileInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) {
    setSelectedFile(null);
    return;
  }

  if (!isIfcFile(file)) {
    setSelectedFile(null);
    showResult({
      ok: false,
      title: "Unsupported file",
      text: "Please select a valid IFC file (.ifc)."
    });
    fileInput.value = "";
    return;
  }

  setSelectedFile(file);
});

if (saveApiBaseBtn && apiBaseInput) {
  apiBaseInput.value = apiBase;

  saveApiBaseBtn.addEventListener("click", () => {
    const nextBase = (apiBaseInput.value || "").trim().replace(/\/+$/, "");
    apiBase = nextBase;
    localStorage.setItem("ifctoglb_api_base", apiBase);
    checkHealth();
  });
}

if (apiBaseInput) {
  apiBaseInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveApiBaseBtn?.click();
    }
  });
}

if (window.location.hostname.endsWith("github.io") && !apiBase && healthPill) {
  healthPill.classList.remove("online");
  healthPill.classList.add("offline");
  healthPill.textContent = "Set Backend API URL, then click Save.";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  resultCard.classList.add("hidden");

  if (!selectedIfcFile) {
    showResult({
      ok: false,
      title: "No file selected",
      text: "Choose an IFC file before starting conversion."
    });
    return;
  }

  if (window.location.hostname.endsWith("github.io") && !apiBase) {
    showResult({
      ok: false,
      title: "Backend URL required",
      text: "Set Backend API URL and click Save before converting."
    });
    return;
  }

  convertBtn.disabled = true;
  requestTimedOut = false;
  currentAbortController = new AbortController();
  startConversionProgress();

  const timeoutId = setTimeout(() => {
    requestTimedOut = true;
    currentAbortController?.abort();
  }, CLIENT_CONVERT_TIMEOUT_MS);

  try {
    const payload = new FormData();
    payload.append("ifcFile", selectedIfcFile);

    const response = await fetch(getApiUrl("/api/convert"), {
      method: "POST",
      body: payload,
      signal: currentAbortController.signal
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) {
      throw new Error(data.error || `Conversion failed (HTTP ${response.status}).`);
    }

    stopConversionProgress(100, "Conversion complete");
    setViewerState({ previewUrl: withApiBase(data.previewUrl) });
    showResult({
      ok: true,
      title: data.cached ? "Done (Cached)" : "Done",
      text: data.cached
        ? `${data.fileName} was served from cache and is ready to download.`
        : `${data.fileName} is ready to download.`,
      downloadUrl: data.downloadUrl,
      fileName: data.fileName
    });
  } catch (error) {
    const aborted = error?.name === "AbortError";
    if (aborted) {
      if (requestTimedOut) {
        stopConversionProgress(0, "Conversion timed out");
        showResult({
          ok: false,
          title: "Conversion timed out",
          text: "The request took too long. Try a smaller IFC file or try again later."
        });
      } else {
        stopConversionProgress(0, "Conversion canceled");
        showResult({
          ok: false,
          title: "Conversion canceled",
          text: "Conversion was canceled before completion."
        });
      }
      return;
    }

    stopConversionProgress(0, "Conversion failed");
    setViewerState({
      previewUrl: "",
      message: "Conversion failed. Try another IFC file to render a preview."
    });
    showResult({
      ok: false,
      title: "Conversion failed",
      text: error.message || "Something went wrong while converting the file."
    });
  } finally {
    clearTimeout(timeoutId);
    currentAbortController = null;
    convertBtn.disabled = false;
  }
});

if (cancelConvertBtn) {
  cancelConvertBtn.addEventListener("click", () => {
    if (!currentAbortController) {
      return;
    }
    cancelConvertBtn.disabled = true;
    requestTimedOut = false;
    currentAbortController.abort();
  });
}

if (resetViewBtn) {
  resetViewBtn.addEventListener("click", () => {
    if (!glbViewer || !currentPreviewUrl) {
      return;
    }

    glbViewer.cameraOrbit = "35deg 70deg 130%";
    glbViewer.cameraTarget = "auto auto auto";
    if (typeof glbViewer.jumpCameraToGoal === "function") {
      glbViewer.jumpCameraToGoal();
    }
  });
}

if (glbViewer && viewerPlaceholder) {
  glbViewer.addEventListener("load", () => {
    viewerPlaceholder.classList.add("hidden");
  });

  glbViewer.addEventListener("error", () => {
    setViewerState({
      previewUrl: "",
      message: "Could not render this GLB preview. You can still download the file."
    });
  });
}

const checkHealth = async () => {
  if (window.location.hostname.endsWith("github.io") && !apiBase) {
    healthPill.classList.remove("online");
    healthPill.classList.add("offline");
    healthPill.textContent = "Set Backend API URL, then click Save.";
    return;
  }

  try {
    const response = await fetch(getApiUrl("/api/health"));
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (data.converterAvailable) {
      healthPill.classList.remove("offline");
      healthPill.classList.add("online");
      healthPill.textContent = `Converter ready: ${data.converter}`;
      return;
    }

    healthPill.classList.remove("online");
    healthPill.classList.add("offline");
    healthPill.textContent = `Converter not found: ${data.converter}`;
  } catch {
    healthPill.classList.remove("online");
    healthPill.classList.add("offline");
    healthPill.textContent = "Backend is not reachable";
  }
};

checkHealth();
