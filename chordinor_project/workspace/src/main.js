import { NOTE_NAMES, analyzeChordino } from "./chordino.js";

const form = document.querySelector("#upload-form");
const input = document.querySelector("#audio-file");
const dropZone = document.querySelector("#drop-zone");
const fileMeta = document.querySelector("#file-meta");
const analyzeButton = document.querySelector("#analyze-button");
const downloadButton = document.querySelector("#download-button");
const statusTitle = document.querySelector("#status-title");
const statusCopy = document.querySelector("#status-copy");
const statusPill = document.querySelector("#status-pill");
const progressBar = document.querySelector("#progress-bar");
const mainChord = document.querySelector("#main-chord");
const chordCount = document.querySelector("#chord-count");
const duration = document.querySelector("#duration");
const songKey = document.querySelector("#song-key");
const songBpm = document.querySelector("#song-bpm");
const timeSignature = document.querySelector("#time-signature");
const songIdentity = document.querySelector("#song-identity");
const metadataNote = document.querySelector("#metadata-note");
const sourceList = document.querySelector("#source-list");
const audioPlayer = document.querySelector("#audio-player");
const playButton = document.querySelector("#play-button");
const playbackTime = document.querySelector("#playback-time");
const transposeDown = document.querySelector("#transpose-down");
const transposeUp = document.querySelector("#transpose-up");
const transposeReset = document.querySelector("#transpose-reset");
const transposeLabel = document.querySelector("#transpose-label");
const tapeStrip = document.querySelector("#tape-strip");
const tapeCanvas = document.querySelector("#tape-canvas");
const tapeContext = tapeCanvas.getContext("2d");
const tapeTooltip = document.querySelector("#tape-tooltip");
const currentChord = document.querySelector("#current-chord");
const zoomSlider = document.querySelector("#zoom-slider");
const viewportSlider = document.querySelector("#viewport-slider");
const canvas = document.querySelector("#chroma-canvas");
const context = canvas.getContext("2d");

let selectedFile = null;
let latestResult = null;
let audioObjectUrl = null;
let playbackFrame = 0;
let tapeZoom = 1;
let viewportStart = 0;
let transposeOffset = 0;
let tapeItems = [];
let tapeDuration = 0;
let tapeAudioFeatures = null;
let hoverSegment = null;

drawEmptyChroma();
updateTransposeControls();
checkNativeHealth();

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
  if (!audioPlayer.src) {
    return;
  }

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
  if (!audioPlayer.duration) {
    return;
  }
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

transposeDown.addEventListener("click", () => {
  setTransposeOffset(transposeOffset - 1);
});

transposeUp.addEventListener("click", () => {
  setTransposeOffset(transposeOffset + 1);
});

transposeReset.addEventListener("click", () => {
  setTransposeOffset(0);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!selectedFile) {
    return;
  }

  setBusy(true);
  setStatus("正在分析音频特征", "Native", "正在先融合 librosa、Essentia 与 Aubio 的 BPM/beat 候选，然后再运行 Chordino 识别和弦。", 8);

  try {
    latestResult = await analyzeWithNativeChordino(selectedFile);
    renderResult(latestResult);
    await enrichSongMetadata(latestResult);
    setStatus("识别完成", "Native", "已先完成本地节奏/调性融合分析，再使用原生 Vamp Chordino 插件生成和弦时间轴。", 100);
  } catch (error) {
    try {
      setStatus("后端不可用，使用回退", "Fallback", `${error.message} 正在使用浏览器端 Chordino 风格算法。`, 12, true);
      latestResult = await analyzeInBrowser(selectedFile);
      renderResult(latestResult);
      await enrichSongMetadata(latestResult);
      setStatus("识别完成", "Fallback", "原生后端不可用，已使用浏览器端 Chordino 风格算法生成结果。", 100);
    } catch (fallbackError) {
      latestResult = null;
      resetResultSummary();
      setStatus("识别失败", "Error", fallbackError.message || "音频处理时发生未知错误。", 0, true);
      drawEmptyChroma();
    }
  } finally {
    setBusy(false);
  }
});

downloadButton.addEventListener("click", () => {
  if (!latestResult) {
    return;
  }

  const payload = JSON.stringify(getTransposedResult(latestResult), null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = buildDownloadFileName(selectedFile?.name || "chordino-result");
  link.click();
  URL.revokeObjectURL(url);
});

function setSelectedFile(file) {
  selectedFile = file;
  latestResult = null;
  transposeOffset = 0;
  updateTransposeControls();
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
  renderPendingMetadata(file.name);
  setStatus("音频已选择", "Ready", "点击开始识别后，将优先调用后端原生 Vamp Chordino 插件。", 0);
}

async function checkNativeHealth() {
  try {
    const response = await fetch("/api/health");
    const health = await response.json();
    if (health.ok) {
      setStatus("原生 Chordino 可用", "Native", health.message, 0);
      return;
    }
    setStatus("原生依赖缺失", "Fallback", `${health.message} 上传后会自动使用浏览器端回退算法。`, 0, true);
  } catch {
    setStatus("后端未连接", "Fallback", "未检测到后端健康检查接口，上传后会尝试使用浏览器端回退算法。", 0, true);
  }
}

async function analyzeWithNativeChordino(file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/analyze", {
    method: "POST",
    body: formData,
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.message || "原生 Chordino 后端调用失败。");
  }

  return payload;
}

async function analyzeInBrowser(file) {
  setStatus("正在解码音频", "Decode", "浏览器正在读取并解码音频文件。", 18);
  const audioContext = new AudioContext();
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  setStatus("正在识别和弦", "Fallback", "正在运行浏览器端 Chordino 风格 chroma 和弦识别流程。", 24);

  const result = await analyzeChordino(audioBuffer, (progress) => {
    setProgress(progress);
  });

  return {
    ...result,
    source: "browser-chordino-style",
  };
}

function renderResult(result) {
  const displayedResult = getTransposedResult(result);
  mainChord.textContent = displayedResult.mainChord;
  chordCount.textContent = formatBarCount(displayedResult.audioFeatures, displayedResult.duration);
  duration.textContent = formatTime(displayedResult.duration);
  downloadButton.disabled = false;
  playButton.disabled = !audioPlayer.src;
  renderTapeStrip(displayedResult.timeline, displayedResult.duration, displayedResult.audioFeatures);
  drawChroma(displayedResult.globalChroma);
}

function getTransposedResult(result) {
  if (!result || !transposeOffset) {
    return result;
  }

  return {
    ...result,
    mainChord: transposeChord(result.mainChord, transposeOffset),
    key: transposeKeyLabel(result.key, transposeOffset),
    audioFeatures: transposeAudioFeatures(result.audioFeatures, transposeOffset),
    metadata: transposeMetadata(result.metadata, transposeOffset),
    globalChroma: transposeChroma(result.globalChroma, transposeOffset),
    timeline: (result.timeline || []).map((item) => ({
      ...item,
      chord: transposeChord(item.chord, transposeOffset),
      originalChord: item.originalChord || item.chord,
    })),
    rawTimeline: (result.rawTimeline || []).map((item) => ({
      ...item,
      chord: transposeChord(item.chord, transposeOffset),
      originalChord: item.originalChord || item.chord,
    })),
    transpose: {
      semitones: transposeOffset,
      label: formatTransposeOffset(transposeOffset),
      source: "client-display-transpose",
    },
  };
}

function transposeAudioFeatures(audioFeatures, semitones) {
  if (!audioFeatures) {
    return audioFeatures;
  }

  return {
    ...audioFeatures,
    key: transposeKeyLabel(audioFeatures.key, semitones),
  };
}

function transposeMetadata(metadata, semitones) {
  if (!metadata) {
    return metadata;
  }

  return {
    ...metadata,
    final: metadata.final
      ? {
          ...metadata.final,
          key: transposeKeyLabel(metadata.final.key, semitones),
        }
      : metadata.final,
  };
}

async function enrichSongMetadata(result) {
  if (result?.metadata) {
    renderMetadata(result.metadata);
    return;
  }

  renderMetadataLoading();

  try {
    const audioFeatures = await analyzeAudioFeatures(selectedFile);
    const response = await fetch("/api/song-meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: selectedFile?.name || "",
        audioFeatures,
      }),
    });
    const metadata = await response.json();

    if (!response.ok) {
      throw new Error(metadata.message || "歌曲元数据聚合失败。");
    }

    latestResult = {
      ...result,
      audioFeatures,
      metadata,
    };
    renderResult(latestResult);
    renderMetadata(metadata);
  } catch (error) {
    metadataNote.textContent = error.message || "歌曲元数据聚合失败。";
    sourceList.innerHTML = "";
  }
}

async function analyzeAudioFeatures(file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/audio-features", {
    method: "POST",
    body: formData,
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.message || "librosa 本地音频分析失败。");
  }

  return payload;
}

function renderPendingMetadata(fileName) {
  const parsed = parseSongName(fileName);
  songKey.textContent = "--";
  songBpm.textContent = "--";
  timeSignature.textContent = "--";
  songIdentity.textContent = parsed;
  metadataNote.textContent = "上传后会先融合 librosa、Essentia 与 Aubio 的 BPM/beat 候选，再运行 Chordino 识别和弦。";
  sourceList.innerHTML = "";
}

function renderMetadataLoading() {
  songKey.textContent = "...";
  songBpm.textContent = "...";
  timeSignature.textContent = "...";
  metadataNote.textContent = "正在融合 librosa、Essentia 与 Aubio 的 BPM/beat 候选，并估算调性与拍号。";
  sourceList.innerHTML = "";
}

function renderMetadata(metadata) {
  songKey.textContent = metadata.final?.key || "待确认";
  songBpm.textContent = metadata.final?.bpm || "待确认";
  timeSignature.textContent = metadata.final?.timeSignature || "待确认";
  songIdentity.textContent = formatSongIdentity(metadata.query);
  metadataNote.textContent = metadata.final?.note || "已完成歌曲元数据聚合。";
  sourceList.innerHTML = "";

  for (const source of metadata.sources || []) {
    const item = document.createElement(source.url ? "a" : "span");
    item.className = `source-chip ${source.available ? "is-available" : ""}`;
    item.textContent = `${source.label}${source.confidence ? ` · ${Math.round(source.confidence * 100)}%` : ""}`;
    item.title = source.notes || "";
    if (source.url) {
      item.href = source.url;
      item.target = "_blank";
      item.rel = "noreferrer";
    }
    sourceList.append(item);
  }
}

function renderTapeStrip(items, totalDuration, audioFeatures = null) {
  tapeItems = items || [];
  tapeDuration = totalDuration || 0;
  tapeAudioFeatures = audioFeatures;
  const empty = tapeStrip.querySelector(".tape-strip__empty");
  updateTransposeControls();

  if (!tapeItems.length || !tapeDuration) {
    empty.hidden = false;
    viewportStart = 0;
    currentChord.textContent = "--";
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
  drawBeatLines(visible, rect.width, rect.height);
  drawChordSegments(visible, rect.width, rect.height);
  drawCanvasPlayhead(visible, rect.width, rect.height);
}

function drawBeatLines(visible, width, height) {
  const beatTimes = tapeAudioFeatures?.beatTimes || [];
  const barLines = tapeAudioFeatures?.barLines || [];
  tapeContext.save();
  for (const beat of beatTimes) {
    if (beat < visible.start || beat > visible.end) {
      continue;
    }
    const x = timeToCanvasX(beat, visible, width);
    tapeContext.strokeStyle = "rgba(255, 255, 255, 0.16)";
    tapeContext.lineWidth = 1;
    tapeContext.beginPath();
    tapeContext.moveTo(x, 0);
    tapeContext.lineTo(x, height);
    tapeContext.stroke();
  }
  for (const bar of barLines) {
    if (bar < visible.start || bar > visible.end) {
      continue;
    }
    const x = timeToCanvasX(bar, visible, width);
    tapeContext.strokeStyle = "rgba(134, 239, 172, 0.72)";
    tapeContext.lineWidth = 2;
    tapeContext.beginPath();
    tapeContext.moveTo(x, 0);
    tapeContext.lineTo(x, height);
    tapeContext.stroke();
  }
  tapeContext.restore();
}

function drawChordSegments(visible, width, height) {
  const top = 26;
  const segmentHeight = height - 42;
  tapeContext.textBaseline = "middle";
  tapeContext.font = "700 16px Poppins";

  for (const item of tapeItems) {
    if (item.end < visible.start || item.start > visible.end) {
      continue;
    }
    const x = timeToCanvasX(Math.max(item.start, visible.start), visible, width);
    const endX = timeToCanvasX(Math.min(item.end, visible.end), visible, width);
    const segmentWidth = Math.max(2, endX - x);
    const color = chordColor(item.chord) || "#64748b";
    const isHover = hoverSegment === item;
    tapeContext.fillStyle = color;
    tapeContext.globalAlpha = isHover ? 1 : 0.88;
    roundRect(tapeContext, x, top, segmentWidth, segmentHeight, 12);
    tapeContext.fill();
    tapeContext.globalAlpha = 1;
    tapeContext.strokeStyle = isHover ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.22)";
    tapeContext.lineWidth = isHover ? 2 : 1;
    tapeContext.stroke();

    if (segmentWidth > 34) {
      tapeContext.fillStyle = "rgba(7, 17, 11, 0.92)";
      tapeContext.fillText(item.chord, x + 10, top + segmentHeight / 2);
    }
  }
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
  tapeContext.arc(x, 13, 6, 0, Math.PI * 2);
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
  tapeTooltip.innerHTML = `<strong>${hoverSegment.chord}</strong>${formatTime(hoverSegment.start)} - ${formatTime(hoverSegment.end)} · ${(hoverSegment.end - hoverSegment.start).toFixed(2)}s`;
  tapeTooltip.hidden = false;
  drawTapeCanvas();
}

function updateCurrentChord(time) {
  const segment = findSegmentAtTime(time, tapeItems);
  currentChord.textContent = segment?.chord || "--";
}

function findSegmentAtTime(time, items) {
  return items.find((item) => time >= item.start && time < item.end) || items.at(-1) || null;
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
  currentChord.textContent = "--";
  tapeStrip.setAttribute("aria-valuenow", "0");
  viewportStart = 0;
  tapeZoom = Number(zoomSlider.value);
  tapeItems = [];
  tapeDuration = 0;
  tapeAudioFeatures = null;
  hoverSegment = null;
  tapeTooltip.hidden = true;
  updateViewportControls(false);
  renderTapeViewport();
  const empty = tapeStrip.querySelector(".tape-strip__empty");
  empty.hidden = false;
}

function setTransposeOffset(nextOffset) {
  transposeOffset = clamp(nextOffset, -11, 11);
  updateTransposeControls();
  if (latestResult?.timeline?.length) {
    renderResult(latestResult);
  }
}

function updateTransposeControls() {
  const hasTimeline = Boolean(latestResult?.timeline?.length);
  transposeDown.disabled = !hasTimeline || transposeOffset <= -11;
  transposeUp.disabled = !hasTimeline || transposeOffset >= 11;
  transposeReset.disabled = !hasTimeline || transposeOffset === 0;
  transposeLabel.textContent = formatTransposeOffset(transposeOffset);
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
  updateCurrentChord(current);
  drawTapeCanvas();
}

function seekFromProgressSlider() {
  const total = audioPlayer.duration || latestResult?.duration || 0;
  if (!total) {
    return;
  }

  const percent = clamp(Number(viewportSlider.value), 0, 100);
  audioPlayer.currentTime = (percent / 100) * total;
  keepPlayheadInView(percent, true);
  updatePlayhead();
}

function seekFromPointer(clientX) {
  const total = audioPlayer.duration || latestResult?.duration || 0;
  if (!total) {
    return;
  }
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

function resetResultSummary() {
  downloadButton.disabled = true;
  mainChord.textContent = "--";
  chordCount.textContent = "--";
  duration.textContent = "0:00";
  songKey.textContent = "--";
  songBpm.textContent = "--";
  timeSignature.textContent = "--";
  renderTapeStrip([], 0);
}

function drawChroma(chroma) {
  const width = canvas.width;
  const height = canvas.height;
  const padding = 34;
  const gap = 12;
  const barWidth = (width - padding * 2 - gap * 11) / 12;
  const maxValue = Math.max(...chroma, 0.01);

  context.clearRect(0, 0, width, height);
  context.fillStyle = "rgba(255,255,255,0.04)";
  context.fillRect(0, 0, width, height);

  chroma.forEach((value, index) => {
    const normalized = value / maxValue;
    const barHeight = normalized * (height - padding * 2 - 30);
    const x = padding + index * (barWidth + gap);
    const y = height - padding - 28 - barHeight;
    const color = noteColor(NOTE_NAMES[index]);
    const gradient = context.createLinearGradient(0, y, 0, height - padding);
    gradient.addColorStop(0, mixHex(color, "#ffffff", 0.42));
    gradient.addColorStop(0.42, color);
    gradient.addColorStop(1, mixHex(color, "#050816", 0.28));

    context.shadowColor = hexToRgba(color, 0.42);
    context.shadowBlur = 18;
    context.shadowOffsetY = 7;
    context.fillStyle = gradient;
    roundRect(context, x, y, barWidth, barHeight, 10);
    context.fill();
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;

    const highlight = context.createLinearGradient(x, y, x + barWidth, y);
    highlight.addColorStop(0, "rgba(255,255,255,0.46)");
    highlight.addColorStop(0.38, "rgba(255,255,255,0.18)");
    highlight.addColorStop(1, "rgba(255,255,255,0.04)");
    context.fillStyle = highlight;
    roundRect(context, x + 4, y + 4, Math.max(2, barWidth * 0.28), Math.max(0, barHeight - 8), 7);
    context.fill();

    context.fillStyle = "#f8fafc";
    context.font = "600 18px Poppins";
    context.textAlign = "center";
    context.fillText(NOTE_NAMES[index], x + barWidth / 2, height - padding);
  });
}

function drawEmptyChroma() {
  drawChroma(new Array(12).fill(0.12));
}

function roundRect(ctx, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
  ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
  ctx.arcTo(x, y + height, x, y, safeRadius);
  ctx.arcTo(x, y, x + width, y, safeRadius);
  ctx.closePath();
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
  const safeSeconds = Math.max(0, seconds || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const rest = Math.floor(safeSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${rest}`;
}

function formatBarCount(audioFeatures, totalDuration) {
  const barLines = Array.isArray(audioFeatures?.barLines) ? audioFeatures.barLines : [];
  if (barLines.length) {
    const hasLeadingPartialBar = Number.isFinite(totalDuration) && barLines[0] > 0.25;
    return String(barLines.length + (hasLeadingPartialBar ? 1 : 0));
  }
  return "--";
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function stripExtension(fileName) {
  return fileName.replace(/\.[^/.]+$/, "");
}

function buildDownloadFileName(fileName) {
  const baseName = stripExtension(fileName || "chordino-result");
  if (!transposeOffset) {
    return `${baseName}.json`;
  }
  const direction = transposeOffset > 0 ? "plus" : "minus";
  return `${baseName}-transpose-${direction}-${Math.abs(transposeOffset)}.json`;
}

function chordColor(chord) {
  if (chord === "N") {
    return "#64748b";
  }
  const root = chord.match(/^([A-G](?:#|b)?)/)?.[1];
  return noteColor(root) || "#64748b";
}

function noteColor(note) {
  switch (note) {
    case "C":
      return "#ef4444";
    case "C#":
    case "Db":
      return "#f97316";
    case "D":
      return "#f59e0b";
    case "D#":
    case "Eb":
      return "#eab308";
    case "E":
      return "#facc15";
    case "F":
      return "#22c55e";
    case "F#":
    case "Gb":
      return "#14b8a6";
    case "G":
      return "#06b6d4";
    case "G#":
    case "Ab":
      return "#0ea5e9";
    case "A":
      return "#3b82f6";
    case "A#":
    case "Bb":
      return "#8b5cf6";
    case "B":
      return "#a855f7";
    default:
      return null;
  }
}

function mixHex(source, target, amount) {
  const a = hexToRgb(source);
  const b = hexToRgb(target);
  const mixed = a.map((value, index) => Math.round(value + (b[index] - value) * amount));
  return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`;
}

function hexToRgba(hex, alpha) {
  const [red, green, blue] = hexToRgb(hex);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((start) => Number.parseInt(value.slice(start, start + 2), 16));
}

function transposeChord(chord, semitones) {
  if (!semitones || !chord || chord === "N") {
    return chord;
  }

  const match = chord.match(/^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?(.*)$/);
  if (!match) {
    return chord;
  }

  const [, root, quality = "", bass, trailing = ""] = match;
  const rootIndex = NOTE_INDEX[root];
  if (rootIndex === undefined) {
    return chord;
  }

  const noteNames = prefersFlatNotes(root) ? FLAT_NOTE_NAMES : SHARP_NOTE_NAMES;
  const transposedRoot = noteNames[wrapSemitone(rootIndex + semitones)];
  if (!bass) {
    return `${transposedRoot}${quality}${trailing}`;
  }
  const bassIndex = NOTE_INDEX[bass];
  if (bassIndex === undefined) {
    return `${transposedRoot}${quality}/${bass}${trailing}`;
  }
  const bassNames = prefersFlatNotes(bass) ? FLAT_NOTE_NAMES : noteNames;
  return `${transposedRoot}${quality}/${bassNames[wrapSemitone(bassIndex + semitones)]}${trailing}`;
}

function transposeKeyLabel(key, semitones) {
  if (!key || !semitones) {
    return key;
  }

  return String(key).replace(/^([A-G](?:#|b)?)(\s+(?:major|minor))?\b/i, (match, root, mode = "") => {
    const rootIndex = NOTE_INDEX[root];
    if (rootIndex === undefined) {
      return match;
    }
    const noteNames = prefersFlatNotes(root) ? FLAT_NOTE_NAMES : SHARP_NOTE_NAMES;
    return `${noteNames[wrapSemitone(rootIndex + semitones)]}${mode}`;
  });
}

function transposeChroma(chroma, semitones) {
  if (!Array.isArray(chroma) || chroma.length !== 12 || !semitones) {
    return chroma;
  }

  const transposed = new Array(12).fill(0);
  chroma.forEach((value, index) => {
    transposed[wrapSemitone(index + semitones)] = value;
  });
  return transposed;
}

function formatTapeSegmentTitle(originalChord, displayedChord, start, end) {
  const timeRange = `${formatTime(start)} - ${formatTime(end)}`;
  if (originalChord === displayedChord) {
    return `${displayedChord} · ${timeRange}`;
  }
  return `${displayedChord} · 原始 ${originalChord} · ${timeRange}`;
}

function formatTransposeOffset(offset) {
  if (offset === 0) {
    return "原调";
  }
  return `${offset > 0 ? "+" : ""}${offset} 半音`;
}

function prefersFlatNotes(root) {
  return root.includes("b");
}

function wrapSemitone(value) {
  return ((value % 12) + 12) % 12;
}

const SHARP_NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NOTE_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const NOTE_INDEX = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseSongName(fileName) {
  return stripExtension(fileName || "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "未命名歌曲";
}

function formatSongIdentity(query) {
  if (!query) {
    return "未命名歌曲";
  }
  return query.artist ? `${query.artist} - ${query.title}` : query.title || query.raw || "未命名歌曲";
}
