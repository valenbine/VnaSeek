import asyncio
import json
import re
import secrets
import sqlite3
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

import httpx
from fastapi import FastAPI, HTTPException, Request
from starlette.background import BackgroundTask
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, HttpUrl

try:
    import yt_dlp
except ImportError:  # pragma: no cover - handled at runtime for clear UI errors
    yt_dlp = None


APP_DIR = Path(__file__).resolve().parent
TOKEN_TTL_SECONDS = 6 * 60 * 60
PARSE_TTL_SECONDS = 30 * 60
MAX_FORMATS = 80
MAX_COOKIE_FILE_BYTES = 16 * 1024 * 1024
ALLOWED_COOKIE_SUFFIXES = {".txt", ".sqlite"}
FFMPEG_PACKAGE_BASE = "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm"
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

app = FastAPI(title="VNASeek Video Parser")

parsed_cache: dict[str, dict[str, Any]] = {}
stream_tokens: dict[str, dict[str, Any]] = {}
ffmpeg_worker_cache: str | None = None


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


def cookie_suffix(filename: str | None) -> str:
    suffix = Path(filename or "").suffix.lower()
    if suffix not in ALLOWED_COOKIE_SUFFIXES:
        raise HTTPException(status_code=400, detail="Cookie 文件仅支持 cookies.txt 或 cookies.sqlite。")
    return suffix


def netscape_bool(value: Any) -> str:
    return "TRUE" if bool(value) else "FALSE"


def convert_firefox_cookie_db(cookie_path: Path) -> Path:
    converted = tempfile.NamedTemporaryFile(prefix="vnaseek-cookie-converted-", suffix=".txt", delete=False)
    converted_path = Path(converted.name)
    converted.close()

    try:
        connection = sqlite3.connect(f"file:{cookie_path}?mode=ro", uri=True)
        try:
            rows = connection.execute(
                """
                SELECT host, path, isSecure, expiry, name, value
                FROM moz_cookies
                WHERE name IS NOT NULL AND value IS NOT NULL
                """
            ).fetchall()
        finally:
            connection.close()

        with converted_path.open("w", encoding="utf-8") as cookie_file:
            cookie_file.write("# Netscape HTTP Cookie File\n")
            for host, path, is_secure, expiry, name, value in rows:
                if not host or not name:
                    continue
                include_subdomains = str(host).startswith(".")
                cookie_file.write(
                    "\t".join([
                        str(host),
                        netscape_bool(include_subdomains),
                        str(path or "/"),
                        netscape_bool(is_secure),
                        str(int(expiry or 0)),
                        str(name),
                        str(value),
                    ]) + "\n"
                )
    except Exception as error:
        converted_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="无法读取 Firefox cookies.sqlite，请确认文件来自 Firefox 配置目录。") from error

    return converted_path


async def save_cookie_upload(upload: Any) -> Path | None:
    if upload is None or not getattr(upload, "filename", None):
        return None

    suffix = cookie_suffix(upload.filename)
    temp_file = tempfile.NamedTemporaryFile(prefix="vnaseek-cookie-", suffix=suffix, delete=False)
    cookie_path = Path(temp_file.name)
    size = 0

    try:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_COOKIE_FILE_BYTES:
                raise HTTPException(status_code=400, detail="Cookie 文件不能超过 16 MB。")
            temp_file.write(chunk)
    except Exception:
        cookie_path.unlink(missing_ok=True)
        raise
    finally:
        temp_file.close()
        await upload.close()

    if size == 0:
        cookie_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Cookie 文件不能为空。")

    return cookie_path


async def read_parse_input(request: Request) -> tuple[str, Path | None]:
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        target_url = str(form.get("url") or "").strip()
        cookie_upload = form.get("cookieFile")
        cookie_file = await save_cookie_upload(cookie_upload)
        return target_url, cookie_file

    payload = await request.json()
    return str(payload.get("url") or "").strip(), None


def sanitized_error(error: Exception, cookie_file: Path | None) -> str:
    text = str(error)
    if cookie_file is not None:
        text = text.replace(str(cookie_file), "[cookie-file]")
    return text


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
    width = item.get("width")
    acodec = item.get("acodec") or "none"
    vcodec = item.get("vcodec") or "none"
    filesize = item.get("filesize") or item.get("filesize_approx")
    format_note = item.get("format_note") or item.get("resolution") or ""
    note_text = str(format_note).lower()
    codec_audio_confirmed = acodec not in {"none", "unknown"}
    codec_video_confirmed = vcodec not in {"none", "unknown"}
    has_audio = acodec != "none" or item.get("abr") is not None or "audio" in note_text
    has_video = vcodec != "none" or height is not None or width is not None
    if vcodec == "none" or "audio only" in note_text:
        has_video = False
    if acodec == "none" and "video only" in note_text:
        has_audio = False
    audio_confirmed = has_audio and (codec_audio_confirmed or item.get("abr") is not None)
    video_confirmed = has_video and (codec_video_confirmed or height is not None or width is not None)
    format_confidence = "confirmed"
    if (has_audio and not audio_confirmed) or (has_video and not video_confirmed):
        format_confidence = "uncertain"
    format_type = "combined"
    if has_video and not has_audio:
        format_type = "video"
    elif has_audio and not has_video:
        format_type = "audio"
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
        "width": width,
        "fps": item.get("fps"),
        "filesize": filesize,
        "filesizeText": item.get("filesize_text"),
        "audioCodec": acodec,
        "videoCodec": vcodec,
        "protocol": item.get("protocol"),
        "hasAudio": has_audio,
        "hasVideo": has_video,
        "audioConfirmed": audio_confirmed,
        "videoConfirmed": video_confirmed,
        "formatConfidence": format_confidence,
        "formatType": format_type,
        "directUrl": first_url(item.get("url")),
        "directUrls": url_list(item.get("url")),
        "httpHeaders": item.get("http_headers") or {},
    }


def first_url(value: Any) -> str | None:
    urls = url_list(value)
    return urls[0] if urls else None


def url_list(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [item for item in value if isinstance(item, str)]
    return []


def browser_safe_url(value: Any) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    if value.startswith("http://"):
        return "https://" + value[len("http://"):]
    return value


def pick_formats(info: dict[str, Any]) -> list[dict[str, Any]]:
    formats = info.get("formats") or []
    visible = []
    for item in formats:
        if not first_url(item.get("url")):
            continue
        compact = compact_format(item)
        if not compact["formatId"]:
            continue
        visible.append(compact)

    audio_only = [item for item in visible if item["hasAudio"] and not item["hasVideo"]]
    visible.sort(
        key=lambda item: (
            1 if item.get("formatConfidence") == "confirmed" else 0,
            1 if item["hasVideo"] and item["hasAudio"] else 0,
            item.get("height") or 0,
            item.get("filesize") or 0,
        ),
        reverse=True,
    )
    selected = visible[:MAX_FORMATS]
    existing_ids = {item["formatId"] for item in selected}
    for item in audio_only:
        if item["formatId"] not in existing_ids:
            selected.append(item)
            existing_ids.add(item["formatId"])
    return selected[:MAX_FORMATS + len(audio_only)]


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
        "thumbnail": browser_safe_url(info.get("thumbnail")),
        "formats": pick_formats(info),
        "subtitles": normalize_subtitles(info, "subtitles"),
        "automaticCaptions": normalize_subtitles(info, "automatic_captions"),
        "httpHeaders": info.get("http_headers") or {},
        "createdAt": now(),
    }
    parsed_cache[parse_id] = normalized
    return normalized


def extract_with_ytdlp(target_url: str, cookie_file: Path | None = None) -> dict[str, Any]:
    if yt_dlp is None:
        raise RuntimeError("yt-dlp 未安装，请先安装 Python 依赖。")

    options = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "extract_flat": False,
    }
    if cookie_file is not None:
        options["cookiefile"] = str(cookie_file)
    with yt_dlp.YoutubeDL(options) as downloader:
        return downloader.extract_info(target_url, download=False)


def extract_with_you_get(target_url: str, cookie_file: Path | None = None) -> dict[str, Any]:
    command = ["you-get", "--json"]
    if cookie_file is not None:
        command.extend(["--cookies", str(cookie_file)])
    command.append(target_url)

    completed = subprocess.run(
        command,
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
            "url": urls,
            "filesize": stream.get("size"),
            "acodec": "unknown",
            "vcodec": "unknown",
            "protocol": "https",
        })
    return {
        "id": payload.get("vid"),
        "title": payload.get("title"),
        "webpage_url": target_url,
        "thumbnail": browser_safe_url(payload.get("thumbnail")),
        "formats": formats,
    }


def classify_parse_failure(yt_error: Exception, you_get_error: Exception, cookie_file: Path | None) -> str:
    details = f"yt-dlp: {sanitized_error(yt_error, cookie_file)}; you-get: {sanitized_error(you_get_error, cookie_file)}"
    lower_details = details.lower()

    if "http error 412" in lower_details or "precondition failed" in lower_details:
        return (
            "解析失败：源站拒绝了当前解析请求（HTTP 412 Precondition Failed）。"
            "这通常表示该链接需要有效 cookie、源站页面上下文或平台校验。"
            "请确认上传的是目标站点的 cookies.txt 或 Firefox cookies.sqlite。"
        )
    if "login" in lower_details or "sign in" in lower_details or "需要登录" in details:
        return "解析失败：该链接需要有效登录 Cookie 或授权访问，请确认 Cookie 文件有效且未过期。"
    if "copyright" in lower_details or "private" in lower_details or "forbidden" in lower_details:
        return "解析失败：该视频不可公开访问或受到源站限制。"
    if "unsupported url" in lower_details or "unsupported" in lower_details:
        return "解析失败：当前链接暂不受 yt-dlp 或 you-get 支持。"
    if "timed out" in lower_details or "timeout" in lower_details:
        return "解析失败：连接源站超时，请稍后重试。"

    return f"解析失败：{details}"


def create_stream_token(
    url: str | list[str],
    headers: dict[str, str] | None,
    filename: str,
    content_type: str | None = None,
    mode: str = "http",
    format_id: str | None = None,
    referer_url: str | None = None,
) -> str:
    token = secrets.token_urlsafe(24)
    stream_tokens[token] = {
        "urls": url_list(url),
        "headers": headers or {},
        "filename": filename,
        "contentType": content_type or "application/octet-stream",
        "mode": mode,
        "formatId": format_id,
        "refererUrl": referer_url,
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


def public_parse_response(normalized: dict[str, Any]) -> dict[str, Any]:
    response = {key: value for key, value in normalized.items() if key not in {"httpHeaders", "createdAt"}}
    response["formats"] = [
        {key: value for key, value in item.items() if key not in {"httpHeaders", "directUrls"}}
        for item in normalized.get("formats") or []
    ]
    return response


def merged_headers(*groups: dict[str, Any] | None) -> dict[str, str]:
    headers: dict[str, str] = {}
    for group in groups:
        for key, value in (group or {}).items():
            if isinstance(key, str) and isinstance(value, str):
                headers[key] = value
    return headers


def set_header_default(headers: dict[str, str], name: str, value: str | None) -> None:
    if not value:
        return
    lower_name = name.lower()
    if any(existing.lower() == lower_name for existing in headers):
        return
    headers[name] = value


def stream_request_headers(entry: dict[str, Any], request: Request) -> dict[str, str]:
    headers = {key: value for key, value in entry["headers"].items() if isinstance(value, str)}
    set_header_default(headers, "User-Agent", DEFAULT_USER_AGENT)
    set_header_default(headers, "Accept", "*/*")
    set_header_default(headers, "Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
    set_header_default(headers, "Referer", entry.get("refererUrl"))
    for header in ("range", "if-range"):
        value = request.headers.get(header)
        if value:
            headers[header] = value
    return headers


def content_disposition(filename: str) -> str:
    ascii_name = re.sub(r'[^A-Za-z0-9._-]+', '-', filename).strip('-') or 'download'
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "message": "视频解析服务已就绪",
        "ytDlpAvailable": yt_dlp is not None,
    }


@app.post("/api/parse")
async def parse_video(request: Request) -> dict[str, Any]:
    cleanup_expired()
    cookie_file: Path | None = None
    parser_cookie_file: Path | None = None

    try:
        target_url, cookie_file = await read_parse_input(request)
        target_url = validate_public_url(target_url)
        parser_cookie_file = convert_firefox_cookie_db(cookie_file) if cookie_file and cookie_file.suffix == ".sqlite" else cookie_file
        try:
            info = await asyncio.to_thread(extract_with_ytdlp, target_url, parser_cookie_file)
            normalized = normalize_info(info, "yt-dlp")
        except Exception as yt_error:
            try:
                info = await asyncio.to_thread(extract_with_you_get, target_url, parser_cookie_file)
                normalized = normalize_info(info, "you-get")
            except Exception as you_get_error:
                raise HTTPException(
                    status_code=422,
                    detail=classify_parse_failure(yt_error, you_get_error, parser_cookie_file or cookie_file),
                ) from you_get_error
    finally:
        if parser_cookie_file is not None and parser_cookie_file != cookie_file:
            parser_cookie_file.unlink(missing_ok=True)
        if cookie_file is not None:
            cookie_file.unlink(missing_ok=True)

    return {"ok": True, "result": public_parse_response(normalized)}


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
            selected.get("directUrls") or direct_url,
            merged_headers(headers, selected.get("httpHeaders")),
            filename,
            mode="http",
            format_id=selected.get("formatId"),
            referer_url=entry.get("webpageUrl"),
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
        token = create_stream_token(thumbnail, headers, f"{title}-cover.jpg", "image/jpeg", referer_url=entry.get("webpageUrl"))
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
        token = create_stream_token(subtitle["url"], headers, filename, "text/vtt", referer_url=entry.get("webpageUrl"))
        return {"ok": True, "directUrl": subtitle["url"], "proxyUrl": f"/api/stream/{token}", "filename": filename}

    if request.asset == "description":
        filename = f"{title}-description.txt"
        return {"ok": True, "filename": filename, "content": entry.get("description") or ""}

    raise HTTPException(status_code=400, detail="未知下载类型。")


@app.get("/api/stream/{token}")
async def stream_asset(token: str, request: Request) -> StreamingResponse:
    cleanup_expired()
    entry = stream_tokens.get(token)
    if not entry:
        raise HTTPException(status_code=404, detail="下载链接已过期，请重新生成。")
    entry["createdAt"] = now()

    async def http_response() -> StreamingResponse:
        request_headers = stream_request_headers(entry, request)

        client = httpx.AsyncClient(timeout=None, follow_redirects=True)
        response = None
        last_status = 502
        for candidate_url in entry.get("urls") or []:
            upstream_request = client.build_request("GET", candidate_url, headers=request_headers)
            response = await client.send(upstream_request, stream=True)
            if response.status_code < 400:
                break
            last_status = response.status_code
            await response.aclose()
            response = None
        if response is None:
            await client.aclose()
            raise HTTPException(status_code=last_status, detail="源站拒绝下载请求，请重新解析后再试。")

        passthrough_headers = {
            "Content-Disposition": content_disposition(entry["filename"]),
            "Accept-Ranges": response.headers.get("accept-ranges", "bytes"),
        }
        for source, target in (
            ("content-length", "Content-Length"),
            ("content-range", "Content-Range"),
            ("content-type", "Content-Type"),
            ("etag", "ETag"),
            ("last-modified", "Last-Modified"),
        ):
            value = response.headers.get(source)
            if value:
                passthrough_headers[target] = value

        async def close_upstream() -> None:
            await response.aclose()
            await client.aclose()

        return StreamingResponse(
            response.aiter_bytes(1024 * 256),
            status_code=response.status_code,
            media_type=response.headers.get("content-type") or entry["contentType"],
            headers=passthrough_headers,
            background=BackgroundTask(close_upstream),
        )

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
            (entry.get("urls") or [""])[0],
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

    if entry.get("mode") != "ytdlp":
        return await http_response()

    headers = {"Content-Disposition": content_disposition(entry["filename"])}
    return StreamingResponse(ytdlp_iterator(), media_type=entry["contentType"], headers=headers)


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(APP_DIR / "index.html")


@app.get("/styles.css")
async def styles() -> FileResponse:
    return FileResponse(APP_DIR / "styles.css")


@app.get("/favicon.ico")
async def favicon() -> Response:
    return Response(status_code=204)


@app.get("/ffmpeg/class-worker.js")
async def ffmpeg_class_worker() -> Response:
    global ffmpeg_worker_cache
    if ffmpeg_worker_cache is None:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            response = await client.get(f"{FFMPEG_PACKAGE_BASE}/worker.js")
            response.raise_for_status()
        ffmpeg_worker_cache = response.text.replace(
            'from "./const.js"',
            f'from "{FFMPEG_PACKAGE_BASE}/const.js"',
        ).replace(
            'from "./errors.js"',
            f'from "{FFMPEG_PACKAGE_BASE}/errors.js"',
        )
    return Response(ffmpeg_worker_cache, media_type="text/javascript")


app.mount("/src", StaticFiles(directory=APP_DIR / "src"), name="src")
app.mount("/static", StaticFiles(directory=APP_DIR), name="static")


@app.exception_handler(HTTPException)
async def http_error_handler(_, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"ok": False, "message": exc.detail})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=5000)
