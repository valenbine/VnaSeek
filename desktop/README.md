# VNASeek Desktop Skeleton

这个目录是 VNASeek Windows 桌面版的最小骨架，目标是：

1. 保持 `../beat_analyzer` 作为原有 Web 项目。
2. 通过 Tauri 提供桌面窗口。
3. 在桌面壳启动时拉起本地 `python3 ../beat_analyzer/backend.py`。
4. 使用本地加载页轮询 `http://127.0.0.1:5000/api/health`，待后端就绪后跳转到实际页面。

## 当前状态

当前骨架已经包含：

1. `src-tauri/` Rust 桌面壳入口。
2. `app/` 本地加载页。
3. Windows NSIS 安装器的基础配置。
4. `icons/` 图标母版与资源目录。
5. `electron/` 桌面主进程入口。
6. `scripts/prepare-desktop-resources.mjs` 资源准备脚本。

当前骨架还未完成：

1. Python 运行时和依赖的随包分发。
2. Windows `ico/png` 图标资源的正式导出文件生成。
3. 在 Windows 上的完整打包验证。

## Python 分发策略

当前桌面骨架已经支持开发态启动：

1. 直接调用系统中的 `python` 或 `python3`
2. 直接运行仓库里的 `../beat_analyzer/backend.py`

真正面向 Windows 用户发布时，建议改成发布态方案：

1. 在安装包资源目录中携带嵌入式 Python 运行时
2. 在安装包资源目录中携带 `beat_analyzer` 副本
3. 在安装包资源目录中携带已安装好的 Python 依赖目录
4. 通过独立 launcher 脚本统一设置 `sys.path` 后再启动后端

推荐资源布局：

```text
resources/
  python/
  backend/
  backend-deps/
  launch_backend.py
```

这样做的目标是让最终用户不需要自己安装 Python。

当前仓库已经补入发布态 launcher 骨架：

1. `desktop/resources/launch_backend.py`
2. `desktop/src-tauri/src/main.rs` 会优先尝试使用安装包资源目录中的 launcher 和嵌入式 Python
3. 若发布态资源不存在，则自动回退到开发态启动方式

## 预期开发环境

需要先安装：

1. Rust 工具链：`rustup`、`cargo`、`rustc`
2. Tauri CLI 依赖
3. Windows 打包所需工具链

## 运行思路

桌面壳本身加载 `app/index.html`，该页面会不断请求本地健康检查接口：

```text
http://127.0.0.1:5000/api/health
```

当本地后端成功启动后，页面自动跳转到：

```text
http://127.0.0.1:5000/
```

## 更快落地的 Electron 路线

当前仓库已经补了一条更快可交付的桌面路径：

1. `electron/main.js` 负责拉起后端并打开桌面窗口。
2. 开发态运行 `npm run desktop:dev`。
3. 打包前运行 `npm run desktop:icons` 生成 `icon.ico` 和桌面图标资源。
4. 打包前运行 `npm run desktop:prepare`，把 `beat_analyzer` 复制到 `desktop/resources/backend/`。
5. 将 Python 依赖安装到 `desktop/resources/backend-deps/`，并放入嵌入式 Python 到 `desktop/resources/python/`。
6. Windows 打包使用 `electron-builder` 的 `nsis` 目标。
7. `nsis.oneClick=false` 且 `allowToChangeInstallationDirectory=true`，安装时可手动选择安装路径。

## 后续建议

1. 先执行 `npm install` 安装 Electron 与打包依赖。
2. 执行 `npm run desktop:dev` 验证桌面壳是否可打开。
3. 执行 `npm run desktop:icons` 生成正式图标资源。
4. 执行 `npm run desktop:prepare` 生成发布态后端资源目录。
5. 将依赖安装进 `resources/backend-deps/` 并准备 `resources/python/`。
6. 执行 `npm run desktop:build` 生成 Windows NSIS 安装包。
