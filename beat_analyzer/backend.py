import asyncio
import json
import re
import secrets
import subprocess
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, HttpUrl

try:
    import yt_dlp
except ImportError:  # pragma: no cover - handled at runtime for clear UI errors
    yt_dlp = None


APP_DIR = Path(__file__).resolve().parent
TOKEN_TTL_SECONDS = 15 * 60
PARSE_TTL_SECONDS = 30 * 60
MAX_FORMATS = 80

app = FastAPI(title="VNASeek Video Parser")

parsed_cache: dict[str, dict[str, Any]] = {}
stream_tokens: dict[str, dict[str, Any]] = {}


class ParseRequest(BaseModel):
    url: HttpUrl


class DownloadRequest(BaseModel):
    parseId: str
    asset: str
    formatId: str | None = None
    language: str | None = None
    subtitleKind: str | None = None


def now() -> float:
    return time.time()


def cleanup_expired() -> None:
    current = now()
    expired_parse_ids = [
        parse_id for parse_id, entry in parsed_cache.items()
        if current - entry["createdAt"] > PARSE_TTL_SECONDS
    ]
    for parse_id in expired_parse_ids:
        parsed_cache.pop(parse_id, None)

    expired_tokens = [
        token for token, entry in stream_tokens.items()
        if current - entry["createdAt"] > TOKEN_TTL_SECONDS
    ]
    for token in expired_tokens:
        stream_tokens.pop(token, None)


def validate_public_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="请输入有效的 http 或 https 视频页面地址。")
    return value


def safe_filename(value: str, fallback: str = "download") -> str:
    cleaned = re.sub(r"[^\w.\-\u4e00-\u9fff]+", "-", value, flags=re.UNICODE).strip("-.")
    return cleaned[:120] or fallback


def duration_text(seconds: Any) -> str:
    if not isinstance(seconds, (int, float)) or seconds <= 0:
        return "--"
    minutes, sec = divmod(int(seconds), 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{sec:02d}"
    return f"{minutes}:{sec:02d}"


def compact_format(item: dict[str, Any]) -> dict[str, Any]:
    ext = item.get("ext") or "unknown"
    height = item.get("height")
    acodec = item.get("acodec") or "none"
    vcodec = item.get("vcodec") or "none"
    filesize = item.get("filesize") or item.get("filesize_approx")
    format_note = item.get("format_note") or item.get("resolution") or ""
    label_parts = [item.get("format_id") or "default"]
    if height:
        label_parts.append(f"{height}p")
    if format_note:
        label_parts.append(str(format_note))
    label_parts.append(ext.upper())

    return {
        "formatId": item.get("format_id"),
        "label": " · ".join(label_parts),
        "ext": ext,
        "height": height,
        "width": item.get("width"),
        "fps": item.get("fps"),
        "filesize": filesize,
        "filesizeText": item.get("filesize_text"),
        "audioCodec": acodec,
        "videoCodec": vcodec,
        "protocol": item.get("protocol"),
        "hasAudio": acodec != "none",
        "hasVideo": vcodec != "none",
        "directUrl": item.get("url"),
    }


def pick_formats(info: dict[str, Any]) -> list[dict[str, Any]]:
    formats = info.get("formats") or []
    visible = []
    for item in formats:
        if not item.get("url"):
            continue
        compact = compact_format(item)
        if not compact["formatId"]:
            continue
        visible.append(compact)

    visible.sort(
        key=lambda item: (
            1 if item["hasVideo"] and item["hasAudio"] else 0,
            item.get("height") or 0,
            item.get("filesize") or 0,
        ),
        reverse=True,
    )
    return visible[:MAX_FORMATS]


def normalize_subtitles(info: dict[str, Any], key: str) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {}
    for language, entries in (info.get(key) or {}).items():
        normalized_entries = []
        for entry in entries or []:
            if entry.get("url"):
                normalized_entries.append({
                    "ext": entry.get("ext") or "unknown",
                    "url": entry.get("url"),
                    "name": entry.get("name") or language,
                })
        if normalized_entries:
            result[language] = normalized_entries
    return result


def normalize_info(info: dict[str, Any], extractor: str) -> dict[str, Any]:
    parse_id = secrets.token_urlsafe(12)
    title = info.get("title") or "untitled"
    normalized = {
        "parseId": parse_id,
        "extractor": extractor,
        "id": info.get("id"),
        "title": title,
        "webpageUrl": info.get("webpage_url") or info.get("original_url"),
        "uploader": info.get("uploader") or info.get("channel") or "--",
        "duration": info.get("duration"),
        "durationText": duration_text(info.get("duration")),
        "description": info.get("description") or "",
        "thumbnail": info.get("thumbnail"),
        "formats": pick_formats(info),
        "subtitles": normalize_subtitles(info, "subtitles"),
        "automaticCaptions": normalize_subtitles(info, "automatic_captions"),
        "httpHeaders": info.get("http_headers") or {},
        "createdAt": now(),
    }
    parsed_cache[parse_id] = normalized
    return normalized


def extract_with_ytdlp(target_url: str) -> dict[str, Any]:
    if yt_dlp is None:
        raise RuntimeError("yt-dlp 未安装，请先安装 Python 依赖。")

    options = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "extract_flat": False,
    }
    with yt_dlp.YoutubeDL(options) as downloader:
        return downloader.extract_info(target_url, download=False)


def extract_with_you_get(target_url: str) -> dict[str, Any]:
    completed = subprocess.run(
        ["you-get", "--json", target_url],
        capture_output=True,
        text=True,
        timeout=45,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or "you-get 解析失败。")
    payload = json.loads(completed.stdout)
    streams = payload.get("streams") or {}
    formats = []
    for format_id, stream in streams.items():
        urls = stream.get("src") or []
        if not urls:
            continue
        formats.append({
            "format_id": format_id,
            "format_note": stream.get("quality") or format_id,
            "ext": stream.get("container") or "mp4",
            "url": urls[0],
            "filesize": stream.get("size"),
            "acodec": "unknown",
            "vcodec": "unknown",
            "protocol": "https",
        })
    return {
        "id": payload.get("vid"),
        "title": payload.get("title"),
        "webpage_url": target_url,
        "thumbnail": payload.get("thumbnail"),
        "formats": formats,
    }


def create_stream_token(
    url: str,
    headers: dict[str, str] | None,
    filename: str,
    content_type: str | None = None,
    mode: str = "http",
    format_id: str | None = None,
) -> str:
    token = secrets.token_urlsafe(24)
    stream_tokens[token] = {
        "url": url,
        "headers": headers or {},
        "filename": filename,
        "contentType": content_type or "application/octet-stream",
        "mode": mode,
        "formatId": format_id,
        "createdAt": now(),
    }
    return token


def get_cached_parse(parse_id: str) -> dict[str, Any]:
    cleanup_expired()
    entry = parsed_cache.get(parse_id)
    if not entry:
        raise HTTPException(status_code=404, detail="解析结果已过期，请重新解析。")
    return entry


def find_format(entry: dict[str, Any], format_id: str | None) -> dict[str, Any]:
    formats = entry.get("formats") or []
    if not formats:
        raise HTTPException(status_code=404, detail="没有可下载格式。")
    if not format_id:
        return formats[0]
    for item in formats:
        if item.get("formatId") == format_id:
            return item
    raise HTTPException(status_code=404, detail="指定格式不存在或已过期。")


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "message": "视频解析服务已就绪",
        "ytDlpAvailable": yt_dlp is not None,
    }


@app.post("/api/parse")
async def parse_video(request: ParseRequest) -> dict[str, Any]:
    cleanup_expired()
    target_url = validate_public_url(str(request.url))

    try:
        info = await asyncio.to_thread(extract_with_ytdlp, target_url)
        normalized = normalize_info(info, "yt-dlp")
    except Exception as yt_error:
        try:
            info = await asyncio.to_thread(extract_with_you_get, target_url)
            normalized = normalize_info(info, "you-get")
        except Exception as you_get_error:
            raise HTTPException(
                status_code=422,
                detail=f"解析失败：yt-dlp: {yt_error}; you-get: {you_get_error}",
            ) from you_get_error

    response = {key: value for key, value in normalized.items() if key not in {"httpHeaders", "createdAt"}}
    return {"ok": True, "result": response}


@app.post("/api/download-url")
async def download_url(request: DownloadRequest) -> dict[str, Any]:
    entry = get_cached_parse(request.parseId)
    title = safe_filename(entry.get("title") or "download")
    headers = entry.get("httpHeaders") or {}

    if request.asset in {"video", "audio"}:
        selected = find_format(entry, request.formatId)
        direct_url = selected.get("directUrl")
        if not direct_url:
            raise HTTPException(status_code=404, detail="该格式没有可用下载地址。")
        ext = selected.get("ext") or "mp4"
        filename = f"{title}-{selected.get('formatId')}.{ext}"
        token = create_stream_token(
            entry.get("webpageUrl") or direct_url,
            headers,
            filename,
            mode="ytdlp",
            format_id=selected.get("formatId"),
        )
        return {
            "ok": True,
            "mode": "direct-or-proxy",
            "directUrl": direct_url,
            "proxyUrl": f"/api/stream/{token}",
            "filename": filename,
        }

    if request.asset == "thumbnail":
        thumbnail = entry.get("thumbnail")
        if not thumbnail:
            raise HTTPException(status_code=404, detail="没有可用封面。")
        token = create_stream_token(thumbnail, headers, f"{title}-cover.jpg", "image/jpeg")
        return {"ok": True, "directUrl": thumbnail, "proxyUrl": f"/api/stream/{token}", "filename": f"{title}-cover.jpg"}

    if request.asset == "subtitle":
        group_key = "automaticCaptions" if request.subtitleKind == "automatic" else "subtitles"
        groups = entry.get(group_key) or {}
        language = request.language or next(iter(groups), None)
        if not language or language not in groups:
            raise HTTPException(status_code=404, detail="没有找到指定字幕。")
        subtitle = groups[language][0]
        ext = subtitle.get("ext") or "vtt"
        filename = f"{title}-{language}.{ext}"
        token = create_stream_token(subtitle["url"], headers, filename, "text/vtt")
        return {"ok": True, "directUrl": subtitle["url"], "proxyUrl": f"/api/stream/{token}", "filename": filename}

    if request.asset == "description":
        filename = f"{title}-description.txt"
        return {"ok": True, "filename": filename, "content": entry.get("description") or ""}

    raise HTTPException(status_code=400, detail="未知下载类型。")


@app.get("/api/stream/{token}")
async def stream_asset(token: str) -> StreamingResponse:
    cleanup_expired()
    entry = stream_tokens.get(token)
    if not entry:
        raise HTTPException(status_code=404, detail="下载链接已过期，请重新生成。")

    async def http_iterator():
        request_headers = {key: value for key, value in entry["headers"].items() if isinstance(value, str)}
        async with httpx.AsyncClient(timeout=None, follow_redirects=True) as client:
            async with client.stream("GET", entry["url"], headers=request_headers) as response:
                response.raise_for_status()
                async for chunk in response.aiter_bytes(1024 * 256):
                    yield chunk

    async def ytdlp_iterator():
        command = [
            "yt-dlp",
            "--quiet",
            "--no-warnings",
            "--no-playlist",
            "-f",
            entry.get("formatId") or "best",
            "-o",
            "-",
            entry["url"],
        ]
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            assert process.stdout is not None
            while True:
                chunk = await asyncio.to_thread(process.stdout.read, 1024 * 256)
                if not chunk:
                    break
                yield chunk
        finally:
            if process.poll() is None:
                process.terminate()
                await asyncio.to_thread(process.wait)

    headers = {"Content-Disposition": f'attachment; filename="{entry["filename"]}"'}
    iterator = ytdlp_iterator() if entry.get("mode") == "ytdlp" else http_iterator()
    return StreamingResponse(iterator, media_type=entry["contentType"], headers=headers)


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(APP_DIR / "index.html")


@app.get("/styles.css")
async def styles() -> FileResponse:
    return FileResponse(APP_DIR / "styles.css")


app.mount("/src", StaticFiles(directory=APP_DIR / "src"), name="src")
app.mount("/static", StaticFiles(directory=APP_DIR), name="static")


@app.exception_handler(HTTPException)
async def http_error_handler(_, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"ok": False, "message": exc.detail})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=5000)
