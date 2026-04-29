const form = document.querySelector("#upload-form");
const input = document.querySelector("#audio-file");
const dropZone = document.querySelector("#drop-zone");
const fileMeta = document.querySelector("#file-meta");
const analyzeButton = document.querySelector("#analyze-button");
const downloadJsonButton = document.querySelector("#download-json-button");
const downloadBeatsButton = document.querySelector("#download-beats-button");
const statusTitle = document.querySelector("#status-title");
const statusCopy = document.querySelector("#status-copy");
const statusPill = document.querySelector("#status-pill");
const progressBar = document.querySelector("#progress-bar");
const beatCount = document.querySelector("#beat-count");
const downbeatCount = document.querySelector("#downbeat-count");
const durationEl = document.querySelector("#duration");
const bpmEl = document.querySelector("#bpm");
const firstBeatEl = document.querySelector("#first-beat");
const firstDownbeatEl = document.querySelector("#first-downbeat");
const audioPlayer = document.querySelector("#audio-player");
const playButton = document.querySelector("#play-button");
const playbackTime = document.querySelector("#playback-time");
const tapeStrip = document.querySelector("#tape-strip");
const tapeCanvas = document.querySelector("#tape-canvas");
const tapeContext = tapeCanvas.getContext("2d");
const tapeTooltip = document.querySelector("#tape-tooltip");
const currentBeat = document.querySelector("#current-beat");
const beatTypeEl = document.querySelector("#beat-type");
const zoomSlider = document.querySelector("#zoom-slider");
const viewportSlider = document.querySelector("#viewport-slider");
const beatList = document.querySelector("#beat-list");
const beatListCount = document.querySelector("#beat-list-count");

let selectedFile = null;
let latestResult = null;
let audioObjectUrl = null;
let playbackFrame = 0;
let tapeZoom = 1;
let viewportStart = 0;
let tapeItems = [];
let tapeDuration = 0;
let hoverSegment = null;

drawEmptyTape();
checkHealth();

input.addEventListener("change", () => {
  setSelectedFile(input.files?.[0] || null);
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("is-dragging");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("is-dragging");
});

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("is-dragging");
  const file = event.dataTransfer?.files?.[0] || null;
  if (file) {
    input.files = event.dataTransfer.files;
    setSelectedFile(file);
  }
});

playButton.addEventListener("click", async () => {
  if (!audioPlayer.src) return;
  if (audioPlayer.paused) {
    await audioPlayer.play();
  } else {
    audioPlayer.pause();
  }
});

audioPlayer.addEventListener("play", () => {
  playButton.textContent = "暂停";
  updatePlaybackLoop();
});

audioPlayer.addEventListener("pause", () => {
  playButton.textContent = "播放";
  cancelAnimationFrame(playbackFrame);
  updatePlayhead();
});

audioPlayer.addEventListener("ended", () => {
  playButton.textContent = "播放";
  cancelAnimationFrame(playbackFrame);
  updatePlayhead();
});

audioPlayer.addEventListener("loadedmetadata", () => {
  updatePlayhead();
});

window.addEventListener("resize", () => {
  drawTapeCanvas();
});

tapeStrip.addEventListener("click", (event) => {
  seekFromPointer(event.clientX);
});

tapeStrip.addEventListener("pointermove", (event) => {
  updateTapeHover(event);
});

tapeStrip.addEventListener("pointerleave", () => {
  hoverSegment = null;
  tapeTooltip.hidden = true;
  drawTapeCanvas();
});

tapeStrip.addEventListener("keydown", (event) => {
  if (!audioPlayer.duration) return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    audioPlayer.currentTime = clamp(audioPlayer.currentTime + direction * 5, 0, audioPlayer.duration);
    updatePlayhead();
  }
});

zoomSlider.addEventListener("input", () => {
  tapeZoom = Number(zoomSlider.value);
  keepPlayheadInView(getCurrentPlaybackPercent(), true);
  updateViewportControls(Boolean(latestResult?.timeline?.length));
  renderTapeViewport();
});

viewportSlider.addEventListener("input", () => {
  seekFromProgressSlider();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedFile) return;

  setBusy(true);
  setStatus("正在分析", "Processing", "正在使用 Beat This! 深度学习模型检测节拍...", 10);

  try {
    latestResult = await analyzeWithBackend(selectedFile);
    renderResult(latestResult);
    setStatus("分析完成", "Done", `检测到 ${latestResult.beatCount} 个 beats 和 ${latestResult.downbeatCount} 个 downbeats`, 100);
  } catch (error) {
    latestResult = null;
    resetResultSummary();
    setStatus("分析失败", "Error", error.message || "节拍检测时发生未知错误。", 0, true);
  } finally {
    setBusy(false);
  }
});

downloadJsonButton.addEventListener("click", () => {
  if (!latestResult) return;
  const payload = JSON.stringify(latestResult, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = buildFileName(selectedFile?.name || "beat-result", "json");
  link.click();
  URL.revokeObjectURL(url);
});

downloadBeatsButton.addEventListener("click", () => {
  if (!latestResult) return;
  const lines = [];
  for (const beat of latestResult.beats) {
    lines.push(`${beat.time.toFixed(3)}\t0`);
  }
  for (const db of latestResult.downbeats) {
    lines.push(`${db.time.toFixed(3)}\t1`);
  }
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = buildFileName(selectedFile?.name || "beat-result", "beats");
  link.click();
  URL.revokeObjectURL(url);
});

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    const health = await response.json();
    if (health.ok) {
      setStatus("服务就绪", "Ready", health.message, 0);
      return;
    }
    setStatus("服务异常", "Warning", health.message, 0, true);
  } catch {
    setStatus("后端未连接", "Offline", "未检测到后端服务，上传后将无法进行分析。", 0, true);
  }
}

async function analyzeWithBackend(file) {
  const formData = new FormData();
  formData.append("file", file);

  setProgress(20);
  setStatus("正在上传", "Uploading", "正在上传音频文件...", 20);

  const response = await fetch("/api/analyze", {
    method: "POST",
    body: formData,
  });

  setProgress(70);
  setStatus("正在分析", "Analyzing", "正在使用深度学习模型检测节拍...", 70);

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.message || "节拍分析失败。");
  }

  setProgress(100);
  return payload;
}

function renderResult(result) {
  beatCount.textContent = result.beatCount || 0;
  downbeatCount.textContent = result.downbeatCount || 0;
  durationEl.textContent = formatTime(result.duration);
  bpmEl.textContent = result.bpm ? result.bpm.toFixed(1) : "--";
  firstBeatEl.textContent = result.firstBeat !== null ? formatTime(result.firstBeat) : "--";
  firstDownbeatEl.textContent = result.firstDownbeat !== null ? formatTime(result.firstDownbeat) : "--";

  downloadJsonButton.disabled = false;
  downloadBeatsButton.disabled = false;
  playButton.disabled = !audioPlayer.src;

  renderTapeStrip(result.timeline, result.duration);
  renderBeatList(result.beats, result.downbeats);
}

function renderTapeStrip(items, totalDuration) {
  tapeItems = items || [];
  tapeDuration = totalDuration || 0;
  const empty = tapeStrip.querySelector(".tape-strip__empty");

  if (!tapeItems.length || !tapeDuration) {
    empty.hidden = false;
    viewportStart = 0;
    currentBeat.textContent = "--";
    beatTypeEl.textContent = "";
    hoverSegment = null;
    tapeTooltip.hidden = true;
    updateViewportControls(false);
    renderTapeViewport();
    updatePlayhead();
    return;
  }

  empty.hidden = true;
  updateViewportControls(true);
  renderTapeViewport();
  updatePlayhead();
}

function drawTapeCanvas() {
  const rect = tapeCanvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * pixelRatio));
  const height = Math.max(1, Math.round(rect.height * pixelRatio));
  if (tapeCanvas.width !== width || tapeCanvas.height !== height) {
    tapeCanvas.width = width;
    tapeCanvas.height = height;
  }

  tapeContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  tapeContext.clearRect(0, 0, rect.width, rect.height);
  tapeContext.fillStyle = "rgba(15, 23, 42, 0.2)";
  tapeContext.fillRect(0, 0, rect.width, rect.height);

  if (!tapeItems.length || !tapeDuration) {
    return;
  }

  const visible = getVisibleTimeRange();
  drawBeatMarkers(visible, rect.width, rect.height);
  drawCanvasPlayhead(visible, rect.width, rect.height);
}

function drawBeatMarkers(visible, width, height) {
  tapeContext.save();

  for (const item of tapeItems) {
    if (item.time < visible.start || item.time > visible.end) {
      continue;
    }
    const x = timeToCanvasX(item.time, visible, width);
    const isDownbeat = item.type === "downbeat";

    tapeContext.strokeStyle = isDownbeat
      ? "rgba(249, 115, 22, 0.9)"
      : "rgba(134, 239, 172, 0.6)";
    tapeContext.lineWidth = isDownbeat ? 4 : 2;

    tapeContext.beginPath();
    tapeContext.moveTo(x, 0);
    tapeContext.lineTo(x, height);
    tapeContext.stroke();

    if (isDownbeat) {
      tapeContext.fillStyle = "#f97316";
      tapeContext.beginPath();
      tapeContext.arc(x, 12, 7, 0, Math.PI * 2);
      tapeContext.fill();
    } else {
      tapeContext.fillStyle = "#86efac";
      tapeContext.beginPath();
      tapeContext.arc(x, 12, 5, 0, Math.PI * 2);
      tapeContext.fill();
    }
  }

  tapeContext.restore();
}

function drawCanvasPlayhead(visible, width, height) {
  const current = audioPlayer.currentTime || 0;
  if (current < visible.start || current > visible.end) {
    return;
  }
  const x = timeToCanvasX(current, visible, width);
  tapeContext.strokeStyle = "#ffffff";
  tapeContext.lineWidth = 3;
  tapeContext.shadowColor = "rgba(134, 239, 172, 0.85)";
  tapeContext.shadowBlur = 14;
  tapeContext.beginPath();
  tapeContext.moveTo(x, 0);
  tapeContext.lineTo(x, height);
  tapeContext.stroke();
  tapeContext.shadowBlur = 0;
  tapeContext.fillStyle = "#86efac";
  tapeContext.beginPath();
  tapeContext.arc(x, 12, 6, 0, Math.PI * 2);
  tapeContext.fill();
}

function updateTapeHover(event) {
  if (!tapeItems.length || !tapeDuration) {
    return;
  }
  const rect = tapeStrip.getBoundingClientRect();
  const visible = getVisibleTimeRange();
  const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  const time = visible.start + ratio * (visible.end - visible.start);
  hoverSegment = findSegmentAtTime(time, tapeItems);
  if (!hoverSegment) {
    tapeTooltip.hidden = true;
    drawTapeCanvas();
    return;
  }
  const left = clamp(event.clientX - rect.left + 12, 10, rect.width - 230);
  const top = clamp(event.clientY - rect.top - 10, 8, rect.height - 76);
  tapeTooltip.style.left = `${left}px`;
  tapeTooltip.style.top = `${top}px`;
  const isDownbeat = hoverSegment.type === "downbeat";
  tapeTooltip.innerHTML = `<strong class="${isDownbeat ? 'downbeat' : ''}">${isDownbeat ? 'DOWNBEAT' : 'BEAT'}</strong>${formatTime(hoverSegment.time)}`;
  tapeTooltip.hidden = false;
  drawTapeCanvas();
}

function updateCurrentBeat(time) {
  const segment = findSegmentAtTime(time, tapeItems);
  if (segment) {
    currentBeat.textContent = formatTime(segment.time);
    beatTypeEl.textContent = segment.type === "downbeat" ? "DOWNBEAT" : "BEAT";
  } else {
    currentBeat.textContent = "--";
    beatTypeEl.textContent = "";
  }
}

function findSegmentAtTime(time, items) {
  let closest = null;
  let minDist = Infinity;
  for (const item of items) {
    const dist = Math.abs(item.time - time);
    if (dist < minDist && item.time <= time + 0.1) {
      minDist = dist;
      closest = item;
    }
  }
  return closest || items.at(-1) || null;
}

function getVisibleTimeRange() {
  const visibleWidth = getVisibleWindowPercent();
  const start = (viewportStart / 100) * tapeDuration;
  const end = Math.min(tapeDuration, ((viewportStart + visibleWidth) / 100) * tapeDuration);
  return { start, end: Math.max(end, start + 0.01) };
}

function timeToCanvasX(time, visible, width) {
  return ((time - visible.start) / (visible.end - visible.start)) * width;
}

function setAudioSource(file) {
  cancelAnimationFrame(playbackFrame);
  if (audioObjectUrl) {
    URL.revokeObjectURL(audioObjectUrl);
  }
  audioObjectUrl = URL.createObjectURL(file);
  audioPlayer.src = audioObjectUrl;
  audioPlayer.currentTime = 0;
  playButton.disabled = true;
  playButton.textContent = "播放";
  updatePlayhead();
}

function resetTransport() {
  cancelAnimationFrame(playbackFrame);
  if (audioObjectUrl) {
    URL.revokeObjectURL(audioObjectUrl);
    audioObjectUrl = null;
  }
  audioPlayer.removeAttribute("src");
  playButton.disabled = true;
  playButton.textContent = "播放";
  playbackTime.textContent = "0:00 / 0:00";
  currentBeat.textContent = "--";
  beatTypeEl.textContent = "";
  tapeStrip.setAttribute("aria-valuenow", "0");
  viewportStart = 0;
  tapeItems = [];
  tapeDuration = 0;
  hoverSegment = null;
  tapeTooltip.hidden = true;
  updateViewportControls(false);
  renderTapeViewport();
  const empty = tapeStrip.querySelector(".tape-strip__empty");
  empty.hidden = false;
}

function updatePlaybackLoop() {
  updatePlayhead();
  playbackFrame = requestAnimationFrame(updatePlaybackLoop);
}

function updatePlayhead() {
  const current = audioPlayer.currentTime || 0;
  const total = audioPlayer.duration || latestResult?.duration || 0;
  const percent = getCurrentPlaybackPercent();
  if (!audioPlayer.paused) {
    keepPlayheadInView(percent);
  }
  tapeStrip.setAttribute("aria-valuenow", String(Math.round(percent)));
  viewportSlider.value = String(percent);
  playbackTime.textContent = `${formatTime(current)} / ${formatTime(total)}`;
  updateCurrentBeat(current);
  drawTapeCanvas();
}

function seekFromProgressSlider() {
  const total = audioPlayer.duration || latestResult?.duration || 0;
  if (!total) return;
  const percent = clamp(Number(viewportSlider.value), 0, 100);
  audioPlayer.currentTime = (percent / 100) * total;
  keepPlayheadInView(percent, true);
  updatePlayhead();
}

function seekFromPointer(clientX) {
  const total = audioPlayer.duration || latestResult?.duration || 0;
  if (!total) return;
  const rect = tapeStrip.getBoundingClientRect();
  const visibleWidth = getVisibleWindowPercent();
  const percent = clamp(viewportStart + ((clientX - rect.left) / rect.width) * visibleWidth, 0, 100);
  audioPlayer.currentTime = (percent / 100) * total;
  keepPlayheadInView(percent, true);
  updatePlayhead();
}

function updateViewportControls(enabled) {
  const visibleWidth = getVisibleWindowPercent();
  const max = Math.max(0, 100 - visibleWidth);
  viewportStart = clamp(viewportStart, 0, max);
  viewportSlider.max = "100";
  viewportSlider.value = String(getCurrentPlaybackPercent());
  viewportSlider.disabled = !enabled;
}

function renderTapeViewport() {
  const visibleWidth = getVisibleWindowPercent();
  const max = Math.max(0, 100 - visibleWidth);
  viewportStart = clamp(viewportStart, 0, max);
  drawTapeCanvas();
}

function keepPlayheadInView(percent, center = false) {
  const visibleWidth = getVisibleWindowPercent();
  const padding = Math.min(visibleWidth * 0.18, 8);
  const max = Math.max(0, 100 - visibleWidth);

  if (center) {
    viewportStart = clamp(percent - visibleWidth / 2, 0, max);
    renderTapeViewport();
    return;
  }

  if (percent < viewportStart + padding) {
    viewportStart = clamp(percent - padding, 0, max);
    renderTapeViewport();
    return;
  }

  if (percent > viewportStart + visibleWidth - padding) {
    viewportStart = clamp(percent - visibleWidth + padding, 0, max);
    renderTapeViewport();
  }
}

function getVisibleWindowPercent() {
  return 100 / Math.max(1, tapeZoom);
}

function getCurrentPlaybackPercent() {
  const total = audioPlayer.duration || latestResult?.duration || 0;
  return total ? clamp(((audioPlayer.currentTime || 0) / total) * 100, 0, 100) : 0;
}

function drawEmptyTape() {
  const rect = tapeCanvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  tapeCanvas.width = Math.max(1, Math.round(rect.width * pixelRatio));
  tapeCanvas.height = Math.max(1, Math.round(rect.height * pixelRatio));
  tapeContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  tapeContext.clearRect(0, 0, rect.width, rect.height);
  tapeContext.fillStyle = "rgba(15, 23, 42, 0.2)";
  tapeContext.fillRect(0, 0, rect.width, rect.height);
}

function resetResultSummary() {
  downloadJsonButton.disabled = true;
  downloadBeatsButton.disabled = true;
  beatCount.textContent = "--";
  downbeatCount.textContent = "--";
  durationEl.textContent = "0:00";
  bpmEl.textContent = "--";
  firstBeatEl.textContent = "--";
  firstDownbeatEl.textContent = "--";
  renderTapeStrip([], 0);
  beatList.innerHTML = "";
  beatListCount.textContent = "";
}

function renderBeatList(beats, downbeats) {
  beatList.innerHTML = "";

  const allBeats = [
    ...beats.map(b => ({ ...b, type: "beat" })),
    ...downbeats.map(b => ({ ...b, type: "downbeat" }))
  ].sort((a, b) => a.time - b.time);

  beatListCount.textContent = `共 ${allBeats.length} 个节拍`;

  const displayBeats = allBeats.slice(0, 100);

  for (const beat of displayBeats) {
    const item = document.createElement("div");
    item.className = `beat-item ${beat.type === "downbeat" ? "downbeat" : ""}`;
    item.innerHTML = `
      <div class="beat-marker"></div>
      <span class="beat-time">${formatTime(beat.time)}</span>
      <span class="beat-type-label">${beat.type === "downbeat" ? "DOWNBEAT" : "BEAT"}</span>
    `;
    beatList.appendChild(item);
  }

  if (allBeats.length > 100) {
    const more = document.createElement("div");
    more.className = "beat-item";
    more.style.gridColumn = "1 / -1";
    more.style.justifyContent = "center";
    more.style.color = "var(--muted)";
    more.textContent = `... 还有 ${allBeats.length - 100} 个节拍`;
    beatList.appendChild(more);
  }
}

function setSelectedFile(file) {
  selectedFile = file;
  latestResult = null;
  analyzeButton.disabled = !file;

  if (!file) {
    fileMeta.hidden = true;
    fileMeta.textContent = "";
    resetTransport();
    return;
  }

  setAudioSource(file);
  renderTapeStrip([], 0);
  fileMeta.hidden = false;
  fileMeta.textContent = `${file.name} · ${formatBytes(file.size)}`;
  resetResultSummary();
  setStatus("音频已就绪", "Ready", "点击开始检测节拍", 0);
}

function setBusy(isBusy) {
  analyzeButton.disabled = isBusy || !selectedFile;
  input.disabled = isBusy;
}

function setStatus(title, pill, copy, progress, isError = false) {
  statusTitle.textContent = title;
  statusPill.textContent = pill;
  statusCopy.textContent = copy;
  statusCopy.classList.toggle("is-error", isError);
  setProgress(progress);
}

function setProgress(value) {
  progressBar.style.width = `${Math.max(0, Math.min(100, value))}%`;
}

function formatTime(seconds) {
  if (seconds === null || seconds === undefined) return "--";
  const safeSeconds = Math.max(0, seconds || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const rest = (safeSeconds % 60).toFixed(2).padStart(5, "0");
  return `${minutes}:${rest}`;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function buildFileName(fileName, ext) {
  const baseName = fileName.replace(/\.[^/.]+$/, "") || "beat-result";
  return `${baseName}.${ext}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}