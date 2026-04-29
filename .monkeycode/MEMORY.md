# 用户指令记忆

本文件记录了用户的指令、偏好和教导，用于在未来的交互中提供参考。

## 格式

### 用户指令条目
用户指令条目应遵循以下格式：

[用户指令摘要]
- Date: [YYYY-MM-DD]
- Context: [提及的场景或时间]
- Instructions:
  - [用户教导或指示的内容，逐行描述]

### 项目知识条目
Agent 在任务执行过程中发现的条目应遵循以下格式：

[项目知识摘要]
- Date: [YYYY-MM-DD]
- Context: Agent 在执行 [具体任务描述] 时发现
- Category: [代码结构|代码模式|代码生成|构建方法|测试方法|依赖关系|环境配置]
- Instructions:
  - [具体的知识点，逐行描述]

## 去重策略
- 添加新条目前，检查是否存在相似或相同的指令
- 若发现重复，跳过新条目或与已有条目合并
- 合并时，更新上下文或日期信息
- 这有助于避免冗余条目，保持记忆文件整洁

## 条目

[视频解析下载 Web 应用方案偏好]
- Date: 2026-04-29
- Context: 用户要求基于 yt-dlp 和 you-get 开发在线视频解析与下载 Web 应用，并先输出方案
- Instructions:
  - 先输出方案，再进入实现阶段。
  - 前端界面需要参考 `Beatthis!.zip` 中的设计资源。

[视频解析下载 MVP 架构]
- Date: 2026-04-29
- Context: Agent 在执行视频解析下载 Web 应用 MVP 实现时发现
- Category: 代码结构
- Instructions:
  - `/workspace/beat_analyzer/backend.py` 使用 FastAPI 提供静态页面、`/api/parse`、`/api/download-url` 和 `/api/stream/{token}`。
  - 大文件下载策略为优先浏览器直连源站；直连不可用时使用短期 token 做后端无落盘流式转发。
  - Python 依赖记录在 `/workspace/beat_analyzer/requirements.txt`，本地启动脚本为 `npm run dev` 或 `python3 backend.py`。

[BeatThis 参考资源位置]
- Date: 2026-04-29
- Context: 用户上传 `BeatThis!.zip` 后记录
- Category: 环境配置
- Instructions:
  - BeatThis 参考压缩包位于 `/workspace/BeatThis!.zip`。
  - 参考包内的视觉基准文件为 `workspace/beat_analyzer/index.html` 和 `workspace/beat_analyzer/styles.css`。

[项目命名]
- Date: 2026-04-29
- Context: 用户指定视频解析 Web 应用项目名称
- Instructions:
  - 项目展示名称统一使用 `VNASeek视频解析`。
  - npm 包名使用兼容格式 `vnaseek-video-parser`。

[URL 输入控件偏好]
- Date: 2026-04-29
- Context: 用户反馈粘贴地址控件无法粘贴且应为多行文本框
- Instructions:
  - 视频地址输入控件应使用多行文本框，便于粘贴 URL。

[受限站点解析策略]
- Date: 2026-04-29
- Context: 用户反馈 BiliBili 链接解析返回 HTTP 412
- Instructions:
  - 对源站返回 HTTP 412、登录限制、私有视频等情况，应展示清晰错误说明。
  - 不实现绕过平台访问控制、风控或反机器人策略的解析逻辑。
  - 不实现网页登录平台获取 cookie 或收集用户平台会话 cookie 的功能。
  - 不实现前端上传 `cookies.sqlite`、Netscape `cookie.txt` 或其他浏览器 cookie 文件后传给 `you-get` / `yt-dlp` 的功能。
  - 客户端加密 cookie 后由服务端解密仍属于服务端接收和使用敏感会话凭据，不作为可接受方案。
  - 若需要登录态解析能力，应限定为完全本地运行的桌面或 CLI 工具，cookie 不离开用户设备。
