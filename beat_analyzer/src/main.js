const form = document.querySelector("#parse-form");
const urlInput = document.querySelector("#video-url");
const parseButton = document.querySelector("#parse-button");
const statusTitle = document.querySelector("#status-title");
const statusCopy = document.querySelector("#status-copy");
const statusPill = document.querySelector("#status-pill");
const progressBar = document.querySelector("#progress-bar");
const formatCount = document.querySelector("#format-count");
const subtitleCount = document.querySelector("#subtitle-count");
const durationEl = document.querySelector("#duration");
const extractorEl = document.querySelector("#extractor");
const videoPreview = document.querySelector("#video-preview");
const formatSelect = document.querySelector("#format-select");
const formatList = document.querySelector("#format-list");
const formatListCount = document.querySelector("#format-list-count");
const downloadMediaButton = document.querySelector("#download-media-button");
const downloadCoverButton = document.querySelector("#download-cover-button");
const downloadDescriptionButton = document.querySelector("#download-description-button");
const downloadSubtitleButton = document.querySelector("#download-subtitle-button");
const currentSelection = document.querySelector("#current-selection");
const selectionType = document.querySelector("#selection-type");

let latestResult = null;

checkHealth();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const targetUrl = urlInput.value.trim();
  if (!targetUrl) return;

  setBusy(true);
  setStatus("正在解析", "Parsing", "正在使用 yt-dlp 获取视频元信息，失败时会尝试 you-get。", 40);
  resetResult();

  try {
    const response = await fetch("/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: targetUrl }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || "解析失败");
    }
    latestResult = payload.result;
    renderResult(latestResult);
    setStatus("解析完成", "Ready", "请选择格式下载。优先直连源站，必要时使用后端无落盘流式转发。", 100);
  } catch (error) {
    setStatus("解析失败", "Error", error.message || "视频解析时发生未知错误。", 0, true);
  } finally {
    setBusy(false);
  }
});

formatSelect.addEventListener("change", () => {
  const selected = getSelectedFormat();
  renderSelection(selected);
});

downloadMediaButton.addEventListener("click", async () => {
  const selected = getSelectedFormat();
  if (!latestResult || !selected) return;
  await requestDownload({ asset: selected.hasVideo ? "video" : "audio", formatId: selected.formatId });
});

downloadCoverButton.addEventListener("click", async () => {
  if (!latestResult?.thumbnail) return;
  await requestDownload({ asset: "thumbnail" });
});

downloadDescriptionButton.addEventListener("click", async () => {
  if (!latestResult) return;
  const payload = await requestDownload({ asset: "description" }, false);
  if (payload?.content !== undefined) {
    downloadBlob(payload.content || "", payload.filename || "description.txt", "text/plain");
  }
});

downloadSubtitleButton.addEventListener("click", async () => {
  if (!latestResult) return;
  const subtitles = latestResult.subtitles || {};
  const automatic = latestResult.automaticCaptions || {};
  const firstLanguage = Object.keys(subtitles)[0] || Object.keys(automatic)[0];
  if (!firstLanguage) return;
  await requestDownload({
    asset: "subtitle",
    language: firstLanguage,
    subtitleKind: subtitles[firstLanguage] ? "manual" : "automatic",
  });
});

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    const health = await response.json();
    if (health.ok) {
      const detail = health.ytDlpAvailable ? health.message : "服务已启动，但 yt-dlp Python 依赖未安装。";
      setStatus("服务就绪", "Ready", detail, 0, !health.ytDlpAvailable);
      return;
    }
    setStatus("服务异常", "Warning", health.message || "服务状态异常。", 0, true);
  } catch {
    setStatus("后端未连接", "Offline", "未检测到解析服务，请先启动 FastAPI 后端。", 0, true);
  }
}

async function requestDownload(options, shouldOpen = true) {
  if (!latestResult?.parseId) return null;
  setStatus("正在生成下载链接", "Preparing", "后端正在生成短期有效的下载地址。", 65);

  const response = await fetch("/api/download-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parseId: latestResult.parseId, ...options }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    setStatus("生成失败", "Error", payload.message || "无法生成下载链接。", 0, true);
    return null;
  }

  setStatus("下载链接已生成", "Ready", "如果直连被浏览器或源站拒绝，请使用后端代理流地址。", 100);
  if (shouldOpen) {
    openDownload(payload.directUrl || payload.proxyUrl, payload.filename);
  }
  return payload;
}

function renderResult(result) {
  const formats = result.formats || [];
  const manualSubtitleCount = countSubtitleEntries(result.subtitles);
  const autoSubtitleCount = countSubtitleEntries(result.automaticCaptions);

  formatCount.textContent = String(formats.length);
  subtitleCount.textContent = String(manualSubtitleCount + autoSubtitleCount);
  durationEl.textContent = result.durationText || "--";
  extractorEl.textContent = result.extractor || "--";

  videoPreview.innerHTML = `
    <div class="video-preview__media">
      ${result.thumbnail ? `<img src="${escapeAttribute(result.thumbnail)}" alt="视频封面" />` : ""}
    </div>
    <div class="video-preview__body">
      <p class="eyebrow">${escapeHtml(result.extractor || "parser")}</p>
      <h3>${escapeHtml(result.title || "未命名视频")}</h3>
      <p>${escapeHtml(result.uploader || "--")} · ${escapeHtml(result.durationText || "--")}</p>
      <p class="video-description">${escapeHtml(truncate(result.description || "暂无描述", 180))}</p>
    </div>
  `;

  renderFormats(formats);
  downloadCoverButton.disabled = !result.thumbnail;
  downloadDescriptionButton.disabled = !result.description;
  downloadSubtitleButton.disabled = manualSubtitleCount + autoSubtitleCount === 0;
}

function renderFormats(formats) {
  formatSelect.innerHTML = "";
  formatList.innerHTML = "";
  formatListCount.textContent = formats.length ? `${formats.length} 个格式` : "";

  if (!formats.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "未找到可下载格式";
    formatSelect.append(option);
    formatSelect.disabled = true;
    downloadMediaButton.disabled = true;
    formatList.innerHTML = '<div class="beat-item">没有可用格式。该站点可能限制下载或需要登录。</div>';
    return;
  }

  for (const item of formats) {
    const option = document.createElement("option");
    option.value = item.formatId;
    option.textContent = buildFormatLabel(item);
    formatSelect.append(option);

    const row = document.createElement("button");
    row.className = "beat-item format-item";
    row.type = "button";
    row.innerHTML = `
      <span>${escapeHtml(buildFormatLabel(item))}</span>
      <strong>${escapeHtml(item.hasVideo ? "Video" : "Audio")}</strong>
    `;
    row.addEventListener("click", () => {
      formatSelect.value = item.formatId;
      renderSelection(item);
      row.scrollIntoView({ block: "nearest" });
    });
    formatList.append(row);
  }

  formatSelect.disabled = false;
  downloadMediaButton.disabled = false;
  renderSelection(formats[0]);
}

function renderSelection(item) {
  if (!item) {
    currentSelection.textContent = "--";
    selectionType.textContent = "";
    return;
  }
  currentSelection.textContent = item.formatId || "默认";
  selectionType.textContent = buildFormatLabel(item);
}

function getSelectedFormat() {
  const selectedId = formatSelect.value;
  return (latestResult?.formats || []).find((item) => item.formatId === selectedId) || null;
}

function buildFormatLabel(item) {
  const parts = [item.label || item.formatId || "default"];
  if (item.filesizeText) parts.push(item.filesizeText);
  if (item.hasVideo && !item.hasAudio) parts.push("video only");
  if (!item.hasVideo && item.hasAudio) parts.push("audio only");
  if (item.protocol) parts.push(item.protocol);
  return parts.join(" · ");
}

function resetResult() {
  latestResult = null;
  formatCount.textContent = "--";
  subtitleCount.textContent = "--";
  durationEl.textContent = "--";
  extractorEl.textContent = "--";
  videoPreview.innerHTML = '<div class="video-preview__empty">解析成功后显示视频信息</div>';
  formatSelect.innerHTML = '<option value="">解析后选择格式</option>';
  formatSelect.disabled = true;
  formatList.innerHTML = "";
  formatListCount.textContent = "";
  downloadMediaButton.disabled = true;
  downloadCoverButton.disabled = true;
  downloadDescriptionButton.disabled = true;
  downloadSubtitleButton.disabled = true;
  renderSelection(null);
}

function setBusy(isBusy) {
  parseButton.disabled = isBusy;
  parseButton.textContent = isBusy ? "解析中..." : "开始解析";
}

function setStatus(title, pill, copy, progress, isError = false) {
  statusTitle.textContent = title;
  statusPill.textContent = pill;
  statusCopy.textContent = copy;
  progressBar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  statusPill.classList.toggle("is-error", isError);
}

function openDownload(url, filename) {
  if (!url) return;
  const link = document.createElement("a");
  link.href = url;
  if (filename) link.download = filename;
  link.rel = "noopener noreferrer";
  link.target = "_blank";
  document.body.append(link);
  link.click();
  link.remove();
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  openDownload(url, filename);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function countSubtitleEntries(groups = {}) {
  return Object.values(groups).reduce((total, entries) => total + entries.length, 0);
}

function truncate(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
