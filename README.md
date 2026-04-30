# VNASeek

VNASeek 是一个面向在线视频解析、预览和下载的 Web 工具。当前核心应用位于 `beat_analyzer/`，基于 FastAPI、yt-dlp、you-get 和 FFmpeg.wasm 构建，目标是在后端不落盘保存大体积媒体文件的前提下，完成视频元信息解析、格式选择、代理流下载、浏览器端音视频合并和预览播放。

## 功能特性

- 解析视频页面 URL，提取标题、作者、时长、封面、描述、字幕和可用媒体格式。
- 支持 yt-dlp 优先解析，失败后回退 you-get。
- 支持可选上传 Netscape `cookies.txt` 或 Firefox `cookies.sqlite` 辅助解析。
- Cookie 文件仅在单次解析中临时使用，解析结束后清理，不保存、不写入日志。
- 支持封面、描述、字幕下载。
- 视频和音频格式分开选择。
- 下载视频时在浏览器端通过 FFmpeg.wasm 合并视频流和音频流。
- 支持音频单独下载，并在下载过程中显示状态和锁定格式选择。
- 点击封面可生成带声音的视频预览，预览和下载任务通过全局媒体任务锁串行执行。
- 后端提供短期 token 代理流，支持 Range 请求和源站请求头透传，降低浏览器直连失败概率。

## 技术栈

- 后端：FastAPI、httpx、yt-dlp、you-get、uvicorn
- 前端：原生 HTML、CSS、JavaScript
- 浏览器端媒体处理：FFmpeg.wasm
- Cookie 兼容：Netscape Cookie 文本、Firefox `moz_cookies` SQLite 转换

## 目录结构

```text
.
├── beat_analyzer/
│   ├── backend.py          # FastAPI 服务、解析、下载 token、代理流和 FFmpeg worker 代理
│   ├── index.html          # Web 页面结构
│   ├── styles.css          # 页面样式
│   ├── src/main.js         # 前端交互、下载、FFmpeg.wasm 合并和预览逻辑
│   ├── requirements.txt    # Python 依赖
│   └── package.json        # npm 启动脚本
└── chordinor_project/      # 早期和弦识别子项目
```

## 快速开始

进入视频解析应用目录：

```bash
cd beat_analyzer
```

安装 Python 依赖：

```bash
pip install --break-system-packages -r requirements.txt
```

启动服务：

```bash
python3 backend.py
```

也可以使用 npm 脚本：

```bash
npm run dev
```

默认访问地址：

```text
http://127.0.0.1:5000/
```

## API 概览

### `GET /api/health`

检查服务状态和 yt-dlp 依赖是否可用。

### `POST /api/parse`

解析视频页面。请求使用 `multipart/form-data`：

- `url`：视频页面地址。
- `cookieFile`：可选，支持 `.txt` 或 `.sqlite`。

返回解析后的元信息、格式列表、字幕、封面和短期 `parseId`。

### `POST /api/download-url`

基于 `parseId` 生成短期下载地址或后端代理流地址。支持资产类型包括：

- `video`
- `audio`
- `thumbnail`
- `subtitle`
- `description`

### `GET /api/stream/{token}`

根据短期 token 进行无落盘代理流转发。服务会尽量透传源站响应头，并支持 Range 请求。

### `GET /ffmpeg/class-worker.js`

为前端 FFmpeg.wasm 提供同源 Worker 入口，避免浏览器跨域 Worker 限制。

## 前端媒体任务策略

前端存在下载视频合并、音频下载、预览合并和播放等高内存任务。为避免多个任务同时竞争同一个 FFmpeg.wasm 实例和浏览器内存，当前实现使用全局媒体任务锁：

- 同一时间只允许一个媒体任务运行。
- 任务期间会禁用视频格式、音频格式、下载视频、下载音频和封面播放入口。
- 任务结束、失败或播放器可播放后恢复控件状态。

## Cookie 与安全说明

- Cookie 文件只用于本次解析。
- 后端会把上传的 Firefox `cookies.sqlite` 转换为临时 Netscape Cookie 文件后传给解析器。
- 上传原文件和转换后的临时文件都会在解析完成或失败后清理。
- 错误信息不会暴露临时 Cookie 文件路径。
- 项目不实现绕过平台访问控制、风控、CAPTCHA 或反机器人机制的功能。

## 限制说明

- FFmpeg.wasm 在浏览器内存中处理媒体文件，超大视频可能导致页面卡顿或内存不足。
- 某些站点的媒体链接具有短期签名、地域限制或登录限制，解析结果可能失效。
- 后端代理流不保存媒体文件，只负责临时转发。
- 当前服务使用进程内缓存保存解析结果和下载 token，重启服务后需要重新解析。

## 开发验证

检查后端语法：

```bash
python3 -m py_compile backend.py
```

检查前端脚本语法：

```bash
node --check src/main.js
```
