const form = document.getElementById("convert-form");
const fileInput = document.getElementById("ifc-file");
const dropzone = document.getElementById("dropzone");
const selectedFile = document.getElementById("selected-file");
const convertBtn = document.getElementById("convert-btn");
const progressCard = document.getElementById("progress-card");
const progressFill = document.getElementById("progress-fill");
const progressValue = document.getElementById("progress-value");
const progressLabel = document.getElementById("progress-label");
const resultCard = document.getElementById("result-card");
const resultTitle = document.getElementById("result-title");
const resultText = document.getElementById("result-text");
const downloadLink = document.getElementById("download-link");
const healthPill = document.getElementById("health-pill");
const glbViewer = document.getElementById("glb-viewer");
const viewerPlaceholder = document.getElementById("viewer-placeholder");
const resetViewBtn = document.getElementById("reset-view-btn");

let selectedIfcFile = null;
let progressTimer = null;
let currentPreviewUrl = "";

const setProgress = (value, message) => {
  const bounded = Math.max(0, Math.min(100, value));
  progressFill.style.width = `${bounded}%`;
  progressValue.textContent = `${Math.round(bounded)}%`;
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
    downloadLink.href = downloadUrl;
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

const startFakeProgress = () => {
  clearInterval(progressTimer);
  progressCard.classList.remove("hidden");
  setProgress(2, "Uploading IFC...");

  progressTimer = setInterval(() => {
    const current = Number.parseFloat(progressFill.style.width) || 0;
    if (current < 90) {
      setProgress(current + Math.random() * 7, "Converting model...");
    }
  }, 280);
};

const stopFakeProgress = (finalValue, message) => {
  clearInterval(progressTimer);
  setProgress(finalValue, message);
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

  convertBtn.disabled = true;
  startFakeProgress();

  try {
    const payload = new FormData();
    payload.append("ifcFile", selectedIfcFile);

    const response = await fetch("/api/convert", {
      method: "POST",
      body: payload
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Conversion failed.");
    }

    stopFakeProgress(100, "Conversion complete");
    setViewerState({ previewUrl: data.previewUrl });
    showResult({
      ok: true,
      title: "Done",
      text: `${data.fileName} is ready to download.`,
      downloadUrl: data.downloadUrl,
      fileName: data.fileName
    });
  } catch (error) {
    stopFakeProgress(0, "Conversion failed");
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
    convertBtn.disabled = false;
  }
});

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
  try {
    const response = await fetch("/api/health");
    const data = await response.json();

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
