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

[Windows 桌面版与品牌展示要求]
- Date: 2026-05-06
- Context: 用户要求输出 Windows 桌面封装方案并补充安装包、页脚与图标要求
- Instructions:
  - 先输出 Windows 桌面封装方案，再进入实现阶段。
  - 前端页面底部需要展示作者信息、邮箱和 GitHub 仓库地址。
  - 作者展示信息使用 `猫仙森MRCAT`。
  - 邮箱展示信息使用 `valnebine@163.com`。
  - 仓库地址展示信息使用 `https://github.com/valenbine/VnaSeek`。
  - Windows 安装包安装时需要允许用户自定义安装路径。
  - 需要为安装包和应用本体设计一组多尺寸图标方案。

[Windows 桌面版骨架结构]
- Date: 2026-05-06
- Context: Agent 在执行 Windows 桌面版骨架搭建时发现
- Category: 代码结构
- Instructions:
  - 桌面版骨架位于 `/workspace/VnaSeek/desktop/`。
  - 桌面壳采用 `Tauri` 结构，入口配置位于 `desktop/src-tauri/tauri.conf.json`。
  - 桌面壳通过 `desktop/src-tauri/src/main.rs` 启动本地 `beat_analyzer/backend.py`。
  - 桌面窗口先加载 `desktop/app/index.html`，再轮询 `http://127.0.0.1:5000/api/health` 并跳转到正式界面。
  - Windows 安装器目标使用 `NSIS`，`installMode` 设为 `both` 以支持安装范围选择。

[桌面版图标资源约定]
- Date: 2026-05-06
- Context: Agent 在执行桌面版图标资源结构补充时发现
- Category: 代码结构
- Instructions:
  - 桌面版图标母版位于 `/workspace/VnaSeek/desktop/icons/app-icon.svg`。
  - 图标生成说明位于 `/workspace/VnaSeek/desktop/icons/README.md`。
  - 在正式导出 `png/ico` 文件之前，不要在 `tauri.conf.json` 中引用不存在的图标文件。
  - 完成图标导出后，再把 `bundle.icon` 指向实际生成的 `32x32.png`、`128x128.png`、`128x128@2x.png`、`icon.png` 和 `icon.ico`。

[桌面版 Python 分发策略]
- Date: 2026-05-06
- Context: Agent 在执行 Windows 桌面版分发方案细化时发现
- Category: 依赖关系
- Instructions:
  - 开发态桌面壳直接调用系统 Python，并运行仓库中的 `beat_analyzer/backend.py`。
  - 发布态桌面版需要随安装包分发嵌入式 Python、后端代码副本和预装依赖目录。
  - 推荐安装包资源布局为 `resources/python/`、`resources/backend/`、`resources/backend-deps/` 与 `resources/launch_backend.py`。
  - 发布态优先使用安装目录内的 Python 运行时，而不是要求最终用户手工安装 Python。
  - 推荐通过独立 launcher 脚本注入 `sys.path`，避免直接修改现有业务后端代码以适配打包路径。

[桌面版后端启动双路径约定]
- Date: 2026-05-06
- Context: Agent 在执行桌面版开发态与发布态双路径启动逻辑实现时发现
- Category: 代码模式
- Instructions:
  - `desktop/src-tauri/src/main.rs` 需要优先检查 Tauri `Resource` 目录中的 `launch_backend.py` 与嵌入式 Python。
  - 若发布态资源存在，则通过 `launch_backend.py` 启动安装包内的后端副本。
  - 若发布态资源不存在，则回退到开发态，直接运行仓库中的 `beat_analyzer/backend.py`。
  - `desktop/resources/launch_backend.py` 负责注入 `backend-deps` 与 `backend` 路径，再运行 `backend.py`。

[Electron 桌面版主交付路径]
- Date: 2026-05-06
- Context: Agent 在执行更快可交付的桌面版实现时发现
- Category: 构建方法
- Instructions:
  - 当前更快的桌面版主路径位于 `/workspace/VnaSeek/desktop/electron/main.js`。
  - 开发态启动命令为 `npm run desktop:dev`。
  - 发布前资源准备命令为 `npm run desktop:prepare`。
  - Windows 安装包构建命令为 `npm run desktop:build`。
  - `electron-builder` 使用 `nsis.oneClick=false` 和 `allowToChangeInstallationDirectory=true`，安装时允许用户选择安装路径。
  - `desktop:build` 不应重复执行 `desktop:prepare`，避免覆盖 CI 里已安装好的 `resources/backend-deps`。
