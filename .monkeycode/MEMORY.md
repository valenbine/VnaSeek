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
