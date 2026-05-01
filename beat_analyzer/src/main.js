const form = document.querySelector("#parse-form");
const urlInput = document.querySelector("#video-url");
const cookieInput = document.querySelector("#cookie-file");
const cookieFileTitle = document.querySelector("#cookie-file-title");
const cookieFileHint = document.querySelector("#cookie-file-hint");
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
const videoFormatSelect = document.querySelector("#video-format-select");
const audioFormatSelect = document.querySelector("#audio-format-select");
const mergeMediaButton = document.querySelector("#merge-media-button");
const downloadAudioButton = document.querySelector("#download-audio-button");
const downloadCoverButton = document.querySelector("#download-cover-button");
const downloadDescriptionButton = document.querySelector("#download-description-button");
const downloadSubtitleButton = document.querySelector("#download-subtitle-button");

let latestResult = null;
let ffmpegInstance = null;
let ffmpegModules = null;
let previewObjectUrl = null;
let activeMediaTask = null;
const previewPlaybackProbe = document.createElement("video");

const MEDIA_TASK_LABELS = {
  "download-video": "下载视频",
  "download-audio": "下载音频",
  preview: "生成预览",
};

checkHealth();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const targetUrl = urlInput.value.split(/\s+/).find(Boolean) || "";
  if (!targetUrl) return;
  const cookieFile = cookieInput?.files?.[0] || null;

  setBusy(true);
  setStatus("正在解析", "处理中", cookieFile ? "正在读取视频信息，并临时使用你上传的 Cookie 文件。" : "正在读取视频信息，请稍候。", 40);
  resetResult();

  try {
    const formData = new FormData();
    formData.append("url", targetUrl);
    if (cookieFile) {
      formData.append("cookieFile", cookieFile);
    }

    const response = await fetch("/api/parse", {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || "解析失败");
    }
    latestResult = payload.result;
    renderResult(latestResult);
    setStatus("解析完成", "Ready", cookieFile ? "Cookie 文件已由后端临时使用并清理。请选择格式下载。" : "请选择格式下载。优先直连源站，必要时使用后端无落盘流式转发。", 100);
  } catch (error) {
    setStatus("解析失败", "Error", error.message || "视频解析时发生未知错误。", 0, true);
  } finally {
    setBusy(false);
  }
});

cookieInput?.addEventListener("change", () => {
  const file = cookieInput.files?.[0];
  if (!file) {
    cookieFileTitle.textContent = "可选：上传 Cookie 文件";
    cookieFileHint.textContent = "支持 Firefox cookies.sqlite 或 Netscape cookies.txt；解析完成后立即删除临时文件。";
    return;
  }
  cookieFileTitle.textContent = file.name;
  cookieFileHint.textContent = `${formatBytes(file.size)} · 仅用于本次解析，不保存、不写日志`;
});

videoFormatSelect.addEventListener("change", () => {
  updateDownloadButtons();
});

audioFormatSelect.addEventListener("change", () => {
  updateDownloadButtons();
});

mergeMediaButton.addEventListener("click", async () => {
  const selected = getSelectedVideoFormat();
  if (!latestResult || !selected) return;
  await mergeSelectedVideo(selected);
});

downloadAudioButton.addEventListener("click", async () => {
  const audio = getSelectedAudioFormat();
  if (!latestResult || !audio) return;
  await downloadSelectedAudio(audio);
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

videoPreview.addEventListener("click", async (event) => {
  const playButton = event.target.closest("[data-preview-play]");
  if (!playButton) return;
  await playPreviewVideo();
});

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    const health = await response.json();
    if (health.ok) {
      const detail = health.ytDlpAvailable ? `${health.message}。支持可选 Cookie 文件解析，Cookie 仅临时使用。` : "服务已启动，但当前部分解析能力不可用。";
      setStatus("服务就绪", "Ready", detail, 0, !health.ytDlpAvailable);
      return;
    }
    setStatus("服务异常", "Warning", health.message || "服务状态异常。", 0, true);
  } catch {
    setStatus("服务未连接", "离线", "未检测到解析服务，请稍后重试。", 0, true);
  }
}

async function requestDownload(options, shouldOpen = true, config = {}) {
  if (!latestResult?.parseId) return null;
  if (!config.silent) {
    setStatus("正在生成下载链接", "Preparing", "后端正在生成短期有效的下载地址。", 65);
  }

  const response = await fetch("/api/download-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parseId: latestResult.parseId, ...options }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    if (!config.silent) {
      setStatus("生成失败", "Error", payload.message || "无法生成下载链接。", 0, true);
    }
    return null;
  }

  if (!config.silent) {
    setStatus("下载链接已生成", "Ready", "正在使用后端代理流下载，以便携带解析时获得的源站请求头。", 100);
  }
  if (shouldOpen) {
    openDownload(payload.proxyUrl || payload.directUrl, payload.filename);
  }
  return payload;
}

async function mergeSelectedVideo(selected) {
  if (!beginMediaTask("download-video")) return;

  if (!selected.hasVideo) {
    setStatus("无法合并", "Warning", "请选择一个视频流，再执行音视频合并。", 0, true);
    endMediaTask("download-video");
    return;
  }

  const audio = getSelectedAudioFormat();
  if (!audio) {
    setStatus("缺少音频", "Warning", "没有找到可单独合并的音频流。", 0, true);
    endMediaTask("download-video");
    return;
  }

  try {
    logMerge("开始合并流程");
    setStatus("准备下载", "处理中", "正在准备视频和音频文件，首次使用可能需要稍等。", 10);
    const ffmpeg = await loadFfmpeg();
    logMerge("FFmpeg.wasm 已加载");
    const { outputData, outputExt } = await mergeMediaStreams(ffmpeg, selected, audio, "下载视频");
    const filename = `${safeDownloadName(latestResult.title || "video")}-merged.${outputExt}`;
    downloadBlob(outputData, filename, mimeTypeForVideo(outputExt));
    setStatus("合并完成", "Ready", "已在浏览器本地生成合并后的视频文件。", 100);
  } catch (error) {
    logMerge(`合并失败：${error.message || error}`);
    setStatus("合并失败", "Error", error.message || "浏览器合并音视频失败。", 0, true);
  } finally {
    endMediaTask("download-video");
  }
}

async function downloadSelectedAudio(audio) {
  if (!beginMediaTask("download-audio")) return;

  try {
  setStatus("准备下载音频", "处理中", "正在准备音频文件。", 20);
    const payload = await requestDownload({ asset: "audio", formatId: audio.formatId }, false);
    if (!payload?.proxyUrl && !payload?.directUrl) {
      throw new Error("无法生成音频下载地址。");
    }

    const audioData = await fetchBinary(payload.proxyUrl || payload.directUrl, "音频", 35, 95);
    const filename = payload.filename || `${safeDownloadName(latestResult.title || "audio")}.${extensionFromFormat(audio, "m4a")}`;
    downloadBlob(audioData, filename, mimeTypeForAudio(extensionFromFormat(audio, "m4a")));
    setStatus("音频下载完成", "Ready", "音频文件已下载完成。", 100);
  } catch (error) {
    setStatus("音频下载失败", "Error", error.message || "音频下载失败，请重新解析后再试。", 0, true);
  } finally {
    endMediaTask("download-audio");
  }
}

async function mergeMediaStreams(ffmpeg, video, audio, labelPrefix) {
  setStatus("准备文件", "处理中", "正在生成视频和音频下载地址。", 18);
  const videoPayload = await requestDownload({ asset: "video", formatId: video.formatId }, false);
  const audioPayload = await requestDownload({ asset: "audio", formatId: audio.formatId }, false);
  if (!videoPayload?.proxyUrl || !audioPayload?.proxyUrl) {
    throw new Error("无法生成音视频代理下载地址。");
  }

  setStatus("下载视频流", "Fetching", "正在把视频流加载到浏览器内存。", 25);
  const videoData = await fetchBinary(videoPayload.proxyUrl, `${labelPrefix}视频流`, 25, 43);
  logMerge(`视频流下载完成：${formatBytes(videoData.byteLength)}`);
  setStatus("下载音频流", "Fetching", "正在把音频流加载到浏览器内存。", 45);
  const audioData = await fetchBinary(audioPayload.proxyUrl, `${labelPrefix}音频流`, 45, 53);
  logMerge(`音频流下载完成：${formatBytes(audioData.byteLength)}`);

  const videoExt = extensionFromFormat(video, "mp4");
  const audioExt = extensionFromFormat(audio, "m4a");
  const outputExt = outputExtension(video, audio);
  const id = Date.now().toString(36);
  const videoName = `input-video-${id}.${videoExt}`;
  const audioName = `input-audio-${id}.${audioExt}`;
  const outputName = `merged-output-${id}.${outputExt}`;

  setStatus("处理视频", "处理中", "正在整理视频文件。", 55);
  await ffmpeg.writeFile(videoName, videoData);
  logMerge("视频流已写入 FFmpeg 文件系统");
  setStatus("处理音频", "处理中", "正在整理音频文件。", 60);
  await ffmpeg.writeFile(audioName, audioData);
  logMerge("音频流已写入 FFmpeg 文件系统");
  setStatus("正在合并", "处理中", "正在生成最终视频文件，不会上传你的媒体内容。", 65);
  logMerge("开始执行 FFmpeg 合并命令");
  const command = [
    "-y",
    "-i",
    videoName,
    "-i",
    audioName,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c",
    "copy",
    "-shortest",
  ];
  if (outputExt === "mp4") {
    command.push("-movflags", "+faststart");
  }
  command.push(outputName);
  logMerge(`FFmpeg 命令：${command.join(" ")}`);
  const exitCode = await ffmpeg.exec(command);
  if (typeof exitCode === "number" && exitCode !== 0) {
    throw new Error("视频合并失败，请稍后重试。");
  }

  setStatus("生成文件", "处理中", "正在生成最终媒体文件。", 95);
  const outputData = await ffmpeg.readFile(outputName);
  logMerge(`合并结果已生成：${formatBytes(outputData.byteLength)}`);
  await cleanupFfmpegFiles(ffmpeg, [videoName, audioName, outputName]);
  return { outputData, outputExt };
}

async function loadFfmpeg() {
  if (ffmpegInstance) return ffmpegInstance;
  if (!ffmpegModules) {
    const [ffmpegPackage, utilPackage] = await Promise.all([
      import("https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/+esm"),
      import("https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/+esm"),
    ]);
    ffmpegModules = { FFmpeg: ffmpegPackage.FFmpeg, toBlobURL: utilPackage.toBlobURL };
  }

  const { FFmpeg, toBlobURL } = ffmpegModules;
  const ffmpeg = new FFmpeg();
  ffmpeg.on("log", ({ message }) => {
    if (message) {
      logMerge(`[ffmpeg] ${message}`);
      statusCopy.textContent = message;
    }
  });
  ffmpeg.on("progress", ({ progress }) => {
    if (Number.isFinite(progress)) {
      setStatus("正在合并", "处理中", "正在生成视频文件。", 65 + Math.round(progress * 30));
    }
  });
  const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
  await ffmpeg.load({
    classWorkerURL: `${window.location.origin}/ffmpeg/class-worker.js`,
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });
  ffmpegInstance = ffmpeg;
  return ffmpegInstance;
}

async function fetchBinary(url, label = "媒体流", startProgress = 0, endProgress = 100) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("下载待合并媒体流失败，请重新解析后再试。");
  }
  const total = Number(response.headers.get("content-length")) || 0;
  if (!response.body) {
    return new Uint8Array(await response.arrayBuffer());
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    const ratio = total ? received / total : 0;
    const progress = total ? startProgress + Math.round((endProgress - startProgress) * ratio) : startProgress;
    setStatus(`下载${label}`, "Fetching", total ? `${formatBytes(received)} / ${formatBytes(total)}` : `已下载 ${formatBytes(received)}`, progress);
  }

  const data = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

async function cleanupFfmpegFiles(ffmpeg, files) {
  await Promise.all(files.map(async (file) => {
    try {
      await ffmpeg.deleteFile(file);
    } catch {
      // Ignore cleanup failures in the in-memory FFmpeg filesystem.
    }
  }));
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
      ${result.thumbnail ? `
        <button class="video-preview__play" type="button" data-preview-play aria-label="播放视频预览">
          <img src="${escapeAttribute(browserSafeUrl(result.thumbnail))}" alt="视频封面" data-preview-thumbnail />
          <span>点击播放</span>
        </button>
      ` : `<div class="video-preview__placeholder">无可用封面</div>`}
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
  downloadAudioButton.disabled = !getSelectedAudioFormat();
  hydrateThumbnailPreview();
}

async function hydrateThumbnailPreview() {
  if (!latestResult?.thumbnail) return;
  const image = videoPreview.querySelector("[data-preview-thumbnail]");
  if (!image) return;
  const payload = await requestDownload({ asset: "thumbnail" }, false, { silent: true });
  const source = payload?.proxyUrl || payload?.directUrl;
  if (source) {
    image.src = source;
  }
}

async function playPreviewVideo() {
  if (!beginMediaTask("preview")) return;

  if (!latestResult) {
    setStatus("无法播放", "Warning", "请先解析视频。", 0, true);
    endMediaTask("preview");
    return;
  }

  try {
    setPreviewOverlay("正在缓冲...");
    const preview = pickPreviewFormats(latestResult.formats || []);
    logMerge(`预览格式选择：video=${preview.video?.formatId || "none"}, audio=${preview.audio?.formatId || "none"}, reason=${preview.reason}, score=${preview.score ?? "n/a"}`);
    if (!preview.video) {
      setStatus("无法播放", "Warning", "没有找到可播放的视频格式。", 0, true);
      return;
    }

    let source = "";
    let message = "";
    if (preview.audio) {
      logMerge("开始生成带声音预览");
      setStatus("准备预览", "Preview", "正在选择最小视频流和音频流生成带声音预览。", 10);
      const ffmpeg = await loadFfmpeg();
      const { outputData, outputExt } = await mergeMediaStreams(ffmpeg, preview.video, preview.audio, "预览");
      revokePreviewObjectUrl();
      previewObjectUrl = URL.createObjectURL(new Blob([outputData], { type: mimeTypeForVideo(outputExt) }));
      source = previewObjectUrl;
      message = "已使用最小视频流和音频流生成同步预览。";
    } else {
      setStatus("准备播放", "Preview", "没有独立音频流，正在播放最小有声视频格式。", 60);
      const payload = await requestDownload({ asset: "video", formatId: preview.video.formatId }, false);
      source = payload?.proxyUrl || payload?.directUrl || "";
      message = preview.video.hasAudio ? "正在播放最小有声视频格式。" : "正在播放最小视频格式；该格式可能没有声音。";
    }

    if (!source) {
      setStatus("播放失败", "Error", "无法生成视频预览地址。", 0, true);
      return;
    }

    videoPreview.querySelector(".video-preview__media").innerHTML = `
      <video class="video-preview__player" controls autoplay playsinline poster="${escapeAttribute(browserSafeUrl(latestResult.thumbnail || ""))}">
        <source src="${escapeAttribute(source)}" />
        当前浏览器不支持直接播放该视频格式。
      </video>
      <div class="video-preview__overlay" data-preview-overlay>正在缓冲...</div>
    `;
    setStatus("开始播放", "Preview", message, 100);
    await bindPreviewPlayerEvents(message);
  } catch (error) {
    logMerge(`预览失败：${error.message || error}`);
    setPreviewOverlay("播放失败");
    setStatus("播放失败", "Error", error.message || "生成带声音预览失败。", 0, true);
  } finally {
    endMediaTask("preview");
  }
}

function pickPreviewFormats(formats) {
  const tiers = [
    { name: "confirmed", items: formats.filter((item) => item.formatConfidence === "confirmed") },
    { name: "fallback", items: formats },
  ];

  for (const tier of tiers) {
    if (!tier.items.length) continue;
    const videoOnly = tier.items.filter((item) => item.hasVideo && !item.hasAudio);
    const anyVideo = tier.items.filter((item) => item.hasVideo);
    const audioOnly = tier.items.filter((item) => item.hasAudio && !item.hasVideo);
    const combined = tier.items.filter((item) => item.hasVideo && item.hasAudio);

    const bestCombined = chooseBestPreviewCombined(combined);
    const bestPair = chooseBestPreviewPair(videoOnly.length ? videoOnly : anyVideo, audioOnly);

    if (bestCombined && bestPair) {
      return bestCombined.score <= bestPair.score
        ? { video: bestCombined.format, audio: null, reason: `prefer-compatible-combined-${tier.name}`, score: bestCombined.score }
        : { video: bestPair.video, audio: bestPair.audio, reason: `prefer-compatible-separate-${tier.name}`, score: bestPair.score };
    }

    if (bestCombined) {
      return { video: bestCombined.format, audio: null, reason: `fallback-compatible-combined-${tier.name}`, score: bestCombined.score };
    }

    if (bestPair) {
      return { video: bestPair.video, audio: bestPair.audio, reason: `fallback-compatible-separate-${tier.name}`, score: bestPair.score };
    }
  }

  const fallback = formats.filter((item) => item.hasVideo).sort(compareSmallVideo)[0] || null;
  return { video: fallback, audio: null, reason: "fallback-video-only", score: fallback ? previewVideoScore(fallback) : Number.MAX_SAFE_INTEGER };
}

function compareSmallVideo(left, right) {
  return formatSizeScore(left) - formatSizeScore(right) || (left.height || 0) - (right.height || 0);
}

function compareSmallAudio(left, right) {
  return formatSizeScore(left) - formatSizeScore(right);
}

function chooseBestPreviewCombined(formats) {
  if (!formats.length) return null;

  let best = null;
  let bestScore = Number.MAX_SAFE_INTEGER;
  let bestSize = Number.MAX_SAFE_INTEGER;
  for (const format of formats) {
    const score = previewCombinedScore(format);
    const size = formatSizeScore(format);
    if (score < bestScore || (score === bestScore && size < bestSize)) {
      best = format;
      bestScore = score;
      bestSize = size;
    }
  }

  return best ? { format: best, score: bestScore } : null;
}

function chooseBestPreviewPair(videoFormats, audioFormats) {
  if (!videoFormats.length || !audioFormats.length) return null;

  let best = null;
  let bestScore = Number.MAX_SAFE_INTEGER;
  let bestSize = Number.MAX_SAFE_INTEGER;
  for (const video of videoFormats) {
    for (const audio of audioFormats) {
      const score = previewPairScore(video, audio);
      const size = formatSizeScore(video) + formatSizeScore(audio);
      if (score < bestScore || (score === bestScore && size < bestSize)) {
        best = { video, audio, score };
        bestScore = score;
        bestSize = size;
      }
    }
  }

  return best;
}

function previewCombinedScore(format) {
  return previewFormatConfidencePenalty(format) + previewBrowserScore(combinedPreviewMimeType(format), "video") + previewVideoScore(format) + previewAudioScore(format) - 1;
}

function previewPairScore(video, audio) {
  let score = previewFormatConfidencePenalty(video) + previewFormatConfidencePenalty(audio) + previewVideoScore(video) + previewAudioScore(audio) + 1;
  const outputExt = outputExtension(video, audio);
  score += previewBrowserScore(outputPreviewMimeType(video, audio), "video");
  score += previewBrowserScore(singleTrackMimeType(video, "video"), "video");
  score += previewBrowserScore(singleTrackMimeType(audio, "audio"), "audio");
  if (outputExt === "mkv") score += 6;
  if (outputExt === "webm") score += 1;
  return score;
}

function previewVideoScore(format) {
  return previewContainerScore(format.ext) + previewVideoCodecScore(format.videoCodec) + previewResolutionScore(format) + previewFilesizeScore(format);
}

function previewAudioScore(format) {
  return previewContainerScore(format.ext) + previewAudioCodecScore(format.audioCodec) + previewFilesizeScore(format);
}

function previewContainerScore(ext) {
  switch (String(ext || "").toLowerCase()) {
    case "mp4":
    case "m4a":
    case "mp3":
    case "aac":
      return 0;
    case "webm":
    case "ogg":
      return 1;
    case "mov":
      return 2;
    case "mkv":
      return 5;
    default:
      return 3;
  }
}

function previewVideoCodecScore(codec) {
  const value = String(codec || "unknown").toLowerCase();
  if (value === "none") return 99;
  if (value === "unknown") return 6;
  if (value.includes("avc") || value.includes("h264")) return 0;
  if (value.includes("vp9") || value.includes("vp8")) return 1;
  if (value.includes("hev") || value.includes("h265") || value.includes("hevc")) return 3;
  if (value.includes("av01") || value.includes("av1")) return 4;
  return 2;
}

function previewAudioCodecScore(codec) {
  const value = String(codec || "unknown").toLowerCase();
  if (value === "none") return 99;
  if (value === "unknown") return 4;
  if (value.includes("mp4a") || value.includes("aac") || value.includes("mp3")) return 0;
  if (value.includes("opus") || value.includes("vorbis")) return 1;
  return 2;
}

function previewResolutionScore(format) {
  const height = Number(format.height) || 0;
  if (!height) return 3;
  if (height < 180) return 2;
  if (height <= 720) return 0;
  if (height <= 1080) return 1;
  return 2;
}

function previewFilesizeScore(format) {
  const size = Number(format.filesize) || 0;
  if (!size) return 1;
  if (size <= 25 * 1024 * 1024) return 0;
  if (size <= 80 * 1024 * 1024) return 1;
  if (size <= 160 * 1024 * 1024) return 2;
  return 3;
}

function previewFormatConfidencePenalty(format) {
  return format?.formatConfidence === "confirmed" ? 0 : 5;
}

function previewBrowserScore(mimeType, kind) {
  if (!mimeType || typeof previewPlaybackProbe.canPlayType !== "function") return 3;
  const support = previewPlaybackProbe.canPlayType(mimeType);
  if (support === "probably") return 0;
  if (support === "maybe") return 1;
  return kind === "audio" ? 2 : 4;
}

function combinedPreviewMimeType(format) {
  return singleTrackMimeType(format, format.hasVideo ? "video" : "audio");
}

function outputPreviewMimeType(video, audio) {
  const ext = outputExtension(video, audio);
  switch (ext) {
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mkv":
      return "video/x-matroska";
    default:
      return `video/${ext}`;
  }
}

function singleTrackMimeType(format, kind) {
  const ext = String(format?.ext || "").toLowerCase();
  if (!ext) return "";
  if (kind === "audio") {
    switch (ext) {
      case "m4a":
      case "mp4":
        return "audio/mp4";
      case "mp3":
        return "audio/mpeg";
      case "aac":
        return "audio/aac";
      case "webm":
        return "audio/webm";
      case "ogg":
        return "audio/ogg";
      case "wav":
        return "audio/wav";
      default:
        return `audio/${ext}`;
    }
  }

  switch (ext) {
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mov":
      return "video/quicktime";
    case "mkv":
      return "video/x-matroska";
    case "ogg":
      return "video/ogg";
    default:
      return `video/${ext}`;
  }
}

function bindPreviewPlayerEvents(successMessage) {
  const player = videoPreview.querySelector(".video-preview__player");
  if (!player) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    player.addEventListener("loadedmetadata", () => logMerge(`预览 loadedmetadata：${player.duration || "unknown"}s ${player.videoWidth || 0}x${player.videoHeight || 0}`), { once: true });
    player.addEventListener("canplay", () => {
      if (!player.videoWidth || !player.videoHeight) {
        logMerge("预览 canplay 但视频尺寸为 0，判定为不适合预览的格式");
        setPreviewOverlay("播放失败");
        setStatus("播放失败", "Error", "当前预览格式只有音频或浏览器不支持视频画面，请稍后重试。", 0, true);
        settle();
        return;
      }
      logMerge("预览 canplay");
      clearPreviewOverlay();
      setStatus("可以播放", "Preview", successMessage, 100);
      settle();
    }, { once: true });
    player.addEventListener("waiting", () => logMerge("预览 waiting：浏览器正在缓冲"));
    player.addEventListener("error", () => {
      const mediaError = player.error;
      logMerge(`预览播放器错误：${mediaError?.code || "unknown"} ${mediaError?.message || ""}`);
      setPreviewOverlay("播放失败");
      setStatus("播放失败", "Error", "浏览器无法播放生成的预览文件，请查看控制台 [merge] 日志。", 0, true);
      settle();
    }, { once: true });
    player.load();
    player.play().catch((error) => {
      logMerge(`预览自动播放被阻止或失败：${error.message || error}`);
      clearPreviewOverlay();
      settle();
    });
  });
}

function formatSizeScore(item) {
  return Number.isFinite(item.filesize) && item.filesize > 0 ? item.filesize : Number.MAX_SAFE_INTEGER;
}

function setPreviewOverlay(message) {
  const media = videoPreview.querySelector(".video-preview__media");
  if (!media) return;
  const existing = media.querySelector("[data-preview-overlay]");
  if (existing) {
    existing.textContent = message;
    return;
  }
  const overlay = document.createElement("div");
  overlay.className = "video-preview__overlay";
  overlay.dataset.previewOverlay = "";
  overlay.textContent = message;
  media.append(overlay);
}

function clearPreviewOverlay() {
  videoPreview.querySelector("[data-preview-overlay]")?.remove();
}

function renderFormats(formats) {
  videoFormatSelect.innerHTML = "";
  audioFormatSelect.innerHTML = "";

  if (!formats.length) {
    setEmptySelect(videoFormatSelect, "未找到视频格式");
    setEmptySelect(audioFormatSelect, "未找到音频格式");
    mergeMediaButton.disabled = true;
    downloadAudioButton.disabled = true;
    return;
  }

  const videoFormats = formats.filter((item) => item.formatType === "video" || item.formatType === "combined" || item.hasVideo);
  const audioFormats = formats.filter((item) => item.formatType === "audio" || (item.hasAudio && !item.hasVideo));

  renderFormatOptions(videoFormatSelect, videoFormats, "未找到视频格式");
  renderFormatOptions(audioFormatSelect, audioFormats, "未找到独立音频格式");
  updateDownloadButtons();
}

function getSelectedVideoFormat() {
  const selectedId = videoFormatSelect.value;
  return (latestResult?.formats || []).find((item) => item.formatId === selectedId) || null;
}

function getSelectedAudioFormat() {
  const selectedId = audioFormatSelect.value;
  return (latestResult?.formats || []).find((item) => item.formatId === selectedId) || null;
}

function renderFormatOptions(select, formats, emptyLabel) {
  select.innerHTML = "";
  if (!formats.length) {
    setEmptySelect(select, emptyLabel);
    return;
  }
  for (const item of formats) {
    const option = document.createElement("option");
    option.value = item.formatId;
    option.textContent = buildFormatLabel(item);
    select.append(option);
  }
  select.disabled = false;
}

function setEmptySelect(select, label) {
  select.innerHTML = "";
  const option = document.createElement("option");
  option.value = "";
  option.textContent = label;
  select.append(option);
  select.disabled = true;
}

function buildFormatLabel(item) {
  const parts = [item.label || item.formatId || "default"];
  if (item.filesizeText) parts.push(item.filesizeText);
  if (item.formatType === "video" || (item.hasVideo && !item.hasAudio)) parts.push("video only");
  if (item.formatType === "audio" || (!item.hasVideo && item.hasAudio)) parts.push("audio only");
  if (item.formatType === "combined") parts.push("video+audio");
  if (item.protocol) parts.push(item.protocol);
  return parts.join(" · ");
}

function formatTypeLabel(item) {
  if (item.formatType === "audio" || (!item.hasVideo && item.hasAudio)) return "Audio";
  if (item.formatType === "combined" || (item.hasVideo && item.hasAudio)) return "Video+Audio";
  return "Video";
}

function updateDownloadButtons() {
  if (activeMediaTask) {
    mergeMediaButton.disabled = true;
    downloadAudioButton.disabled = true;
    return;
  }
  mergeMediaButton.disabled = !getSelectedVideoFormat() || !getSelectedAudioFormat();
  downloadAudioButton.disabled = !getSelectedAudioFormat();
}

function restoreFormatSelects() {
  videoFormatSelect.disabled = !hasSelectableOption(videoFormatSelect);
  audioFormatSelect.disabled = !hasSelectableOption(audioFormatSelect);
  updateDownloadButtons();
}

function hasSelectableOption(select) {
  return Array.from(select.options).some((option) => option.value);
}

function beginMediaTask(taskName) {
  if (activeMediaTask) {
    const current = MEDIA_TASK_LABELS[activeMediaTask] || "媒体任务";
    const next = MEDIA_TASK_LABELS[taskName] || "该操作";
    setStatus("请稍后", "Busy", `正在${current}，请完成后再${next}。`, progressBarValue());
    return false;
  }

  activeMediaTask = taskName;
  setMediaTaskLocked(true, taskName);
  return true;
}

function endMediaTask(taskName) {
  if (activeMediaTask !== taskName) return;
  activeMediaTask = null;
  setMediaTaskLocked(false, null);
}

function setMediaTaskLocked(isLocked, taskName) {
  videoFormatSelect.disabled = isLocked || !hasSelectableOption(videoFormatSelect);
  audioFormatSelect.disabled = isLocked || !hasSelectableOption(audioFormatSelect);
  mergeMediaButton.disabled = isLocked || !getSelectedVideoFormat() || !getSelectedAudioFormat();
  downloadAudioButton.disabled = isLocked || !getSelectedAudioFormat();
  mergeMediaButton.textContent = taskName === "download-video" ? "合并中..." : "下载视频";
  downloadAudioButton.textContent = taskName === "download-audio" ? "下载中..." : "下载音频";
  setPreviewPlayDisabled(isLocked);
}

function setPreviewPlayDisabled(isDisabled) {
  videoPreview.querySelectorAll("[data-preview-play]").forEach((button) => {
    button.disabled = isDisabled;
  });
}

function progressBarValue() {
  const value = Number.parseFloat(progressBar.style.width);
  return Number.isFinite(value) ? value : 0;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function logMerge(message) {
  console.log(`[merge] ${message}`);
}

function extensionFromFormat(item, fallback) {
  const ext = String(item.ext || fallback).replace(/[^a-z0-9]/gi, "").toLowerCase() || fallback;
  if (ext === "m4s") return fallback;
  return ext;
}

function outputExtension(video, audio) {
  const videoExt = extensionFromFormat(video, "mp4");
  const audioExt = extensionFromFormat(audio, "m4a");
  if (videoExt === "mp4" && ["m4a", "mp4", "aac"].includes(audioExt)) return "mp4";
  if (videoExt === "webm" && audioExt === "webm") return "webm";
  return "mkv";
}

function mimeTypeForVideo(ext) {
  if (ext === "webm") return "video/webm";
  if (ext === "mkv") return "video/x-matroska";
  return "video/mp4";
}

function mimeTypeForAudio(ext) {
  if (ext === "webm") return "audio/webm";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "ogg") return "audio/ogg";
  if (ext === "wav") return "audio/wav";
  return "audio/mp4";
}

function safeDownloadName(value) {
  return String(value).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "download";
}

function browserSafeUrl(value) {
  const text = String(value || "");
  return text.startsWith("http://") ? `https://${text.slice("http://".length)}` : text;
}

function revokePreviewObjectUrl() {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = null;
  }
}

function resetResult() {
  revokePreviewObjectUrl();
  latestResult = null;
  formatCount.textContent = "--";
  subtitleCount.textContent = "--";
  durationEl.textContent = "--";
  extractorEl.textContent = "--";
  videoPreview.innerHTML = '<div class="video-preview__empty">解析成功后显示视频信息</div>';
  videoFormatSelect.innerHTML = '<option value="">解析后选择视频</option>';
  audioFormatSelect.innerHTML = '<option value="">解析后选择音频</option>';
  videoFormatSelect.disabled = true;
  audioFormatSelect.disabled = true;
  mergeMediaButton.disabled = true;
  downloadAudioButton.disabled = true;
  downloadCoverButton.disabled = true;
  downloadDescriptionButton.disabled = true;
  downloadSubtitleButton.disabled = true;
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
