import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8000);
const UPLOAD_DIR = path.join(__dirname, ".runtime", "uploads");
const BUNDLED_SONIC_ANNOTATOR = path.join(
  __dirname,
  ".runtime",
  "tools",
  "sonic-annotator-1.7.0-linux64-static",
  "squashfs-root",
  "usr",
  "bin",
  "sonic-annotator",
);
const BUNDLED_SONIC_LIB_DIR = path.join(
  __dirname,
  ".runtime",
  "tools",
  "sonic-annotator-1.7.0-linux64-static",
  "squashfs-root",
  "usr",
  "lib",
);
const BUNDLED_VAMP_PATH = path.join(__dirname, ".runtime", "vamp");
const SONIC_ANNOTATOR = process.env.SONIC_ANNOTATOR || BUNDLED_SONIC_ANNOTATOR;
const CHORDINO_TRANSFORM = process.env.CHORDINO_TRANSFORM || "vamp:nnls-chroma:chordino:simplechord";
const SONIC_ENV = {
  VAMP_PATH: process.env.VAMP_PATH || BUNDLED_VAMP_PATH,
  LD_LIBRARY_PATH: [BUNDLED_SONIC_LIB_DIR, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":"),
};
const MAX_UPLOAD_BYTES = 120 * 1024 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const PYTHON = process.env.PYTHON || "python3";

await mkdir(UPLOAD_DIR, { recursive: true });

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/api/health") {
      return sendJson(response, 200, await getHealth());
    }

    if (request.method === "POST" && request.url === "/api/analyze") {
      return handleAnalyze(request, response);
    }

    if (request.method === "POST" && request.url === "/api/audio-features") {
      return handleAudioFeatures(request, response);
    }

    if (request.method === "POST" && request.url === "/api/song-meta") {
      return handleSongMeta(request, response);
    }

    return serveStatic(request, response);
  } catch (error) {
    return sendJson(response, 500, {
      error: "internal_error",
      message: error.message || "服务器内部错误。",
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Chordino Web server listening on http://127.0.0.1:${PORT}`);
});

async function handleAnalyze(request, response) {
  try {
    const contentType = request.headers["content-type"] || "";
    const boundary = contentType.match(/boundary=(.+)$/)?.[1];

    if (!boundary) {
      return sendJson(response, 400, {
        error: "invalid_upload",
        message: "请求必须使用 multipart/form-data 上传音频。",
      });
    }

    const body = await readRequestBody(request, MAX_UPLOAD_BYTES);
    const file = await extractMultipartFile(body, boundary);

    if (!file) {
      return sendJson(response, 400, {
        error: "missing_file",
        message: "没有找到名为 file 的音频字段。",
      });
    }

    const audioFeatures = await runLibrosa(file.path);
    const chordinoResult = await runChordino(file.path, audioFeatures);
    const metadata = buildSongMetadata(file.fileName, audioFeatures);
    const result = {
      ...chordinoResult,
      audioFeatures,
      metadata,
    };
    return sendJson(response, 200, result);
  } catch (error) {
    return sendJson(response, error.statusCode || 500, {
      error: error.payload?.error || "analysis_failed",
      message: error.message || "和弦分析失败。",
      detail: error.payload?.detail || error.payload || null,
    });
  }
}

async function handleAudioFeatures(request, response) {
  try {
    const file = await readUploadedFile(request);
    const features = await runLibrosa(file.path);
    return sendJson(response, 200, features);
  } catch (error) {
    return sendJson(response, error.statusCode || 500, {
      error: error.payload?.error || "audio_features_failed",
      message: error.message || "本地音频特征分析失败。",
      detail: error.payload?.detail || null,
    });
  }
}

async function handleSongMeta(request, response) {
  try {
    const body = await readJsonBody(request, MAX_JSON_BYTES);
    const fileName = typeof body.fileName === "string" ? body.fileName : "";
    const audioFeatures = body.audioFeatures && typeof body.audioFeatures === "object" ? body.audioFeatures : null;

    return sendJson(response, 200, buildSongMetadata(fileName, audioFeatures));
  } catch (error) {
    return sendJson(response, 500, {
      error: "metadata_failed",
      message: error.message || "歌曲元数据聚合失败。",
    });
  }
}

async function readUploadedFile(request) {
  const contentType = request.headers["content-type"] || "";
  const boundary = contentType.match(/boundary=(.+)$/)?.[1];

  if (!boundary) {
    const error = new Error("请求必须使用 multipart/form-data 上传音频。");
    error.statusCode = 400;
    error.payload = { error: "invalid_upload" };
    throw error;
  }

  const body = await readRequestBody(request, MAX_UPLOAD_BYTES);
  const file = await extractMultipartFile(body, boundary);

  if (!file) {
    const error = new Error("没有找到名为 file 的音频字段。");
    error.statusCode = 400;
    error.payload = { error: "missing_file" };
    throw error;
  }

  return file;
}

async function getHealth() {
  const version = await runCommand(SONIC_ANNOTATOR, ["--version"], 5000, SONIC_ENV);
  if (version.code !== 0) {
    return {
      ok: false,
      analyzer: SONIC_ANNOTATOR,
      transform: CHORDINO_TRANSFORM,
      message: "未检测到 sonic-annotator。请安装 sonic-annotator 与 Vamp NNLS Chroma/Chordino 插件。",
      detail: version.stderr || version.error || "command_not_found",
    };
  }

  const plugins = await runCommand(SONIC_ANNOTATOR, ["-l"], 8000, SONIC_ENV);
  const pluginOutput = `${plugins.stdout}\n${plugins.stderr}`.toLowerCase();
  const hasChordino = pluginOutput.includes("chordino") || pluginOutput.includes("nnls-chroma");

  return {
    ok: hasChordino,
    analyzer: SONIC_ANNOTATOR,
    transform: CHORDINO_TRANSFORM,
    version: version.stdout.trim() || version.stderr.trim(),
    message: hasChordino
      ? "sonic-annotator 与 Chordino 插件可用。"
      : "检测到 sonic-annotator，但没有发现 Chordino/NNLS Chroma Vamp 插件。",
  };
}

async function runChordino(filePath, audioFeatures = null) {
  const health = await getHealth();
  if (!health.ok) {
    const error = new Error(health.message);
    error.statusCode = 503;
    error.payload = health;
    throw error;
  }

  const output = await runCommand(
    SONIC_ANNOTATOR,
    ["-d", CHORDINO_TRANSFORM, "-w", "csv", "--csv-stdout", filePath],
    120000,
    SONIC_ENV,
  );

  if (output.code !== 0) {
    const error = new Error(output.stderr || "sonic-annotator 执行失败。");
    error.statusCode = 502;
    error.payload = { error: "analyzer_failed", detail: output.stderr };
    throw error;
  }

  const rawTimeline = parseChordinoCsv(output.stdout);
  const timeline = filterShortChordSegments(rawTimeline, audioFeatures);
  const duration = rawTimeline.at(-1)?.end || timeline.at(-1)?.end || 0;

  return {
    source: "native-chordino",
    analyzer: SONIC_ANNOTATOR,
    transform: CHORDINO_TRANSFORM,
    duration,
    frameCount: timeline.length,
    rawFrameCount: rawTimeline.length,
    mainChord: findMainChord(timeline),
    globalChroma: estimateChromaFromTimeline(timeline),
    rawTimeline,
    timeline,
    postProcessing: {
      shortChordFilter: buildShortChordFilterSummary(rawTimeline, timeline, audioFeatures),
    },
  };
}

async function runLibrosa(filePath) {
  const output = await runCommand(PYTHON, [path.join(__dirname, "analyze_audio.py"), filePath], 120000);

  if (output.code !== 0) {
    const parsed = parseJson(output.stderr) || parseJson(output.stdout);
    const error = new Error(parsed?.message || output.stderr || "librosa 音频分析失败。");
    error.statusCode = 502;
    error.payload = { error: parsed?.error || "librosa_failed", detail: output.stderr };
    throw error;
  }

  const parsed = parseJson(output.stdout);
  if (!parsed) {
    const error = new Error("librosa 输出不是有效 JSON。");
    error.statusCode = 502;
    error.payload = { error: "invalid_librosa_output", detail: output.stdout };
    throw error;
  }

  return parsed;
}

function parseChordinoCsv(csv) {
  const rows = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCsvLine)
    .map(parseChordRow)
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  return rows.map((row, index) => {
    const nextStart = rows[index + 1]?.start;
    return {
      chord: normalizeChordLabel(row.chord),
      start: row.start,
      end: row.duration ? row.start + row.duration : nextStart || row.start + 0.5,
      confidence: null,
      confidenceSource: "not-provided-by-chordino",
    };
  });
}

function parseChordRow(columns) {
  const numbers = columns
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value))
    .filter(Number.isFinite);
  const label = [...columns].reverse().find((value) => value && !Number.isFinite(Number(value)));

  if (!label || !numbers.length) {
    return null;
  }

  return {
    start: numbers[0],
    duration: numbers.length > 1 ? numbers[1] : 0,
    chord: label,
  };
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function normalizeChordLabel(label) {
  const cleaned = label.replace(/^"|"$/g, "").trim();
  if (!cleaned || cleaned === "N" || cleaned.toLowerCase() === "no chord") {
    return "N";
  }
  return cleaned.replace(/:maj$/, "").replace(/:min$/, "m");
}

function findMainChord(timeline) {
  const totals = new Map();

  for (const segment of timeline) {
    if (segment.chord === "N") {
      continue;
    }
    totals.set(segment.chord, (totals.get(segment.chord) || 0) + segment.end - segment.start);
  }

  return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "N";
}

function filterShortChordSegments(timeline, audioFeatures) {
  if (!Array.isArray(timeline) || timeline.length < 2) {
    return timeline || [];
  }

  const beatTimes = Array.isArray(audioFeatures?.beatTimes) ? audioFeatures.beatTimes.filter(Number.isFinite) : [];
  const fallbackBeatLength = getFallbackBeatLength(timeline, beatTimes);
  const filtered = [];

  for (let index = 0; index < timeline.length; index += 1) {
    const segment = { ...timeline[index] };
    const duration = Math.max(0, Number(segment.end || 0) - Number(segment.start || 0));
    const beatLength = getLocalBeatLength(segment, beatTimes, fallbackBeatLength);
    const isShort = beatLength > 0 && duration > 0 && duration < beatLength * 0.75;

    if (!isShort) {
      appendTimelineSegment(filtered, segment);
      continue;
    }

    const previous = filtered.at(-1);
    const next = timeline[index + 1];
    const nearFirstBeat = beatTimes.length ? segment.start <= beatTimes[0] + beatLength * 0.5 : index === 0;

    if (!previous || nearFirstBeat) {
      if (next) {
        appendTimelineSegment(filtered, {
          ...segment,
          chord: next.chord,
          confidence: next.confidence ?? segment.confidence,
          confidenceSource: "short-chord-filled-from-next",
        });
      } else {
        appendTimelineSegment(filtered, segment);
      }
      continue;
    }

    previous.end = Math.max(previous.end, segment.end);
    previous.confidenceSource = previous.confidenceSource || "short-chord-filled-from-previous";
  }

  return filtered;
}

function appendTimelineSegment(timeline, segment) {
  const previous = timeline.at(-1);
  if (previous && previous.chord === segment.chord) {
    previous.end = Math.max(previous.end, segment.end);
    return;
  }
  timeline.push(segment);
}

function getFallbackBeatLength(timeline, beatTimes) {
  if (beatTimes.length > 1) {
    return median(diffPositive(beatTimes));
  }
  const duration = Math.max(0, timeline.at(-1)?.end || 0);
  const estimatedBeatCount = Math.max(1, Math.round(duration / 0.5));
  return duration ? duration / estimatedBeatCount : 0.5;
}

function getLocalBeatLength(segment, beatTimes, fallback) {
  if (beatTimes.length < 2) {
    return fallback;
  }
  const center = (segment.start + segment.end) / 2;
  const intervals = [];
  for (let index = 1; index < beatTimes.length; index += 1) {
    const left = beatTimes[index - 1];
    const right = beatTimes[index];
    if (Math.abs((left + right) / 2 - center) <= fallback * 4) {
      intervals.push(right - left);
    }
  }
  return median(intervals.filter((value) => value > 0)) || fallback;
}

function diffPositive(values) {
  const diffs = [];
  for (let index = 1; index < values.length; index += 1) {
    const diff = values[index] - values[index - 1];
    if (diff > 0) {
      diffs.push(diff);
    }
  }
  return diffs;
}

function median(values) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function buildShortChordFilterSummary(rawTimeline, timeline, audioFeatures) {
  return {
    enabled: true,
    threshold: "0.75 beat",
    beatSource: audioFeatures?.beatSource || "fallback-duration-grid",
    rawFrameCount: rawTimeline.length,
    frameCount: timeline.length,
    removedFrameCount: Math.max(0, rawTimeline.length - timeline.length),
  };
}

function estimateKeyFromTimeline(timeline, mainChord) {
  const scores = new Array(24).fill(0);
  const roots = new Map([
    ["C", 0],
    ["C#", 1],
    ["Db", 1],
    ["D", 2],
    ["D#", 3],
    ["Eb", 3],
    ["E", 4],
    ["F", 5],
    ["F#", 6],
    ["Gb", 6],
    ["G", 7],
    ["G#", 8],
    ["Ab", 8],
    ["A", 9],
    ["A#", 10],
    ["Bb", 10],
    ["B", 11],
  ]);

  for (const segment of timeline) {
    const chord = String(segment.chord || "");
    const match = chord.match(/^([A-G][b#]?)(m|min|maj|dim|sus|7|$)/);
    const root = roots.get(match?.[1]);
    if (root === undefined) {
      continue;
    }

    const weight = Math.max(0.05, Number(segment.end || 0) - Number(segment.start || 0));
    const isMinor = /^(?:[A-G][b#]?)(m|min)/.test(chord);
    scores[root] += weight * (isMinor ? 0.75 : 1);
    scores[12 + root] += weight * (isMinor ? 1 : 0.45);
  }

  const mainMatch = String(mainChord || "").match(/^([A-G][b#]?)(m|min)?/);
  const mainRoot = roots.get(mainMatch?.[1]);
  if (mainRoot !== undefined) {
    scores[mainMatch?.[2] ? 12 + mainRoot : mainRoot] += 2;
  }

  const total = scores.reduce((sum, value) => sum + value, 0);
  const bestIndex = scores.indexOf(Math.max(...scores));
  const confidence = total ? scores[bestIndex] / total : 0;

  if (bestIndex < 0 || scores[bestIndex] === 0) {
    return { key: null, confidence: 0, notes: "没有足够的和弦片段估算调性。" };
  }

  const root = NOTE_NAMES[bestIndex % 12];
  const mode = bestIndex >= 12 ? "minor" : "major";
  return {
    key: `${root} ${mode}`,
    confidence: Number(confidence.toFixed(2)),
    notes: "根据和弦根音持续时间与主和弦推断，非专业调性检测模型。",
  };
}

function parseSongQuery(fileName) {
  const baseName = path.basename(fileName || "").replace(/\.[^.]+$/, "");
  const cleaned = baseName
    .replace(/[_]+/g, " ")
    .replace(/\s*\([^)]*\)|\s*\[[^\]]*\]/g, " ")
    .replace(/\b(official|audio|video|lyrics|lyric|mv|hq|remaster(?:ed)?|clean|explicit)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const separator = cleaned.match(/\s+-\s+|\s+–\s+|\s+—\s+/)?.[0];

  if (!separator) {
    return {
      raw: cleaned || baseName,
      title: cleaned || baseName,
      artist: "",
      searchTerm: cleaned || baseName,
      source: "filename",
    };
  }

  const [left, ...rest] = cleaned.split(separator);
  const right = rest.join(separator).trim();

  return {
    raw: cleaned,
    title: right || left,
    artist: right ? left.trim() : "",
    searchTerm: right ? `${right} ${left}` : cleaned,
    source: "filename-artist-title",
  };
}

function buildSongMetadata(fileName, audioFeatures) {
  const query = parseSongQuery(fileName);
  const timeSignatureSource = audioFeatures?.timeSignatureSource || "local-audio-feature-fusion";
  const meterSourceLabel = formatFeatureSourceLabel(timeSignatureSource);
  const sources = [
    buildSource(
      "local-audio-feature-fusion",
      "本地综合音频分析",
      Boolean(audioFeatures),
      audioFeatures?.bpmConfidence || 0,
      null,
      "先融合 librosa、Essentia 与 Aubio 的 BPM/beat 候选，再进行和弦识别。",
    ),
    buildSource(
      "librosa-ks-profile",
      "librosa 调性估算",
      Boolean(audioFeatures?.key),
      audioFeatures?.keyConfidence || 0,
      null,
      "使用 chroma_cqt 与 Krumhansl-Schmuckler key profile 估算调性。",
    ),
    buildSource(
      timeSignatureSource,
      meterSourceLabel,
      Boolean(audioFeatures?.timeSignature),
      audioFeatures?.timeSignatureConfidence || 0,
      null,
      audioFeatures?.notes || "使用 beat 序列与重音周期估算拍号。",
    ),
  ].filter(Boolean);

  return {
    query,
    final: {
      key: audioFeatures?.key || null,
      bpm: audioFeatures?.bpm || null,
      timeSignature: audioFeatures?.timeSignature || null,
      confidence: Math.max(
        audioFeatures?.bpmConfidence || 0,
        audioFeatures?.keyConfidence || 0,
        audioFeatures?.timeSignatureConfidence || 0,
      ),
      note: audioFeatures
        ? `BPM/beat 来自 librosa、Essentia 与 Aubio 候选融合；调性来自本地 chroma 分析；拍号来自 ${meterSourceLabel} 的 beat 序列启发式估算。`
        : "未收到本地音频特征结果。",
    },
    candidates: {
      localAudio: audioFeatures,
      bpm: audioFeatures?.bpmCandidates || [],
      beat: audioFeatures?.beatCandidates || [],
      key: audioFeatures?.keyCandidates || [],
    },
    sources,
  };
}

function formatFeatureSourceLabel(source) {
  if (source === "essentia-rhythmextractor2013") {
    return "Essentia RhythmExtractor2013";
  }
  if (source === "aubio") {
    return "Aubio beat tracking";
  }
  if (source === "librosa") {
    return "librosa beat tracking";
  }
  return "本地综合音频分析";
}

function buildSource(id, label, available, confidence, url, notes) {
  return { id, label, available, confidence, url, notes };
}

function parseJson(value) {
  try {
    const trimmed = String(value || "").trim();
    if (!trimmed) {
      return null;
    }
    return JSON.parse(trimmed.split(/\r?\n/).at(-1));
  } catch {
    return null;
  }
}

function estimateChromaFromTimeline(timeline) {
  const chroma = new Array(12).fill(0);
  const names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  const aliases = new Map([
    ["Db", "C#"],
    ["D#", "Eb"],
    ["Gb", "F#"],
    ["G#", "Ab"],
    ["A#", "Bb"],
  ]);

  for (const segment of timeline) {
    const root = segment.chord.match(/^[A-G][b#]?/)?.[0];
    const normalized = aliases.get(root) || root;
    const index = names.indexOf(normalized);
    if (index >= 0) {
      chroma[index] += Math.max(0.01, segment.end - segment.start);
    }
  }

  const max = Math.max(...chroma, 1);
  return chroma.map((value) => value / max);
}

function runCommand(command, args, timeoutMs, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: __dirname, env: { ...process.env, ...extraEnv } });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr, error: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function readRequestBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("上传文件过大。"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function readJsonBody(request, maxBytes) {
  const body = await readRequestBody(request, maxBytes);
  if (!body.length) {
    return {};
  }
  return JSON.parse(body.toString("utf8"));
}

async function extractMultipartFile(body, boundary) {
  const boundaryText = `--${boundary}`;
  const sections = body.toString("latin1").split(boundaryText);

  for (const section of sections) {
    if (!section.includes('name="file"')) {
      continue;
    }

    const headerEnd = section.indexOf("\r\n\r\n");
    if (headerEnd < 0) {
      continue;
    }

    const headers = section.slice(0, headerEnd);
    const fileName = headers.match(/filename="([^"]+)"/)?.[1] || "upload.audio";
    const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
    const content = section.slice(headerEnd + 4).replace(/\r\n--$/, "").replace(/\r\n$/, "");
    const target = path.join(UPLOAD_DIR, `${Date.now()}-${safeName}`);

    await writeFileFromLatin1(target, content);
    return { path: target, fileName: safeName };
  }

  return null;
}

function writeFileFromLatin1(target, content) {
  return new Promise((resolve, reject) => {
    const stream = createWriteStream(target);
    stream.on("error", reject);
    stream.on("finish", resolve);
    stream.end(Buffer.from(content, "latin1"));
  });
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const normalized = path.normalize(decodeURIComponent(requestedPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(__dirname, normalized);

  if (!filePath.startsWith(__dirname)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat?.isFile()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const stream = createReadStream(filePath);
  stream.on("error", () => {
    response.destroy();
  });

  response.writeHead(200, { "Content-Type": getContentType(filePath) });
  stream.pipe(response);
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
    }[extension] || "application/octet-stream"
  );
}

function sendJson(response, statusCode, data) {
  const payload = data instanceof Error ? { message: data.message } : data;
  response.writeHead(data.statusCode || statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

process.on("uncaughtException", (error) => {
  console.error(error);
});
