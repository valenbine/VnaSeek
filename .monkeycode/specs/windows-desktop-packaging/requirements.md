# Requirements Document

## Introduction

本文档定义 VNASeek 在不影响现有 Web 项目的前提下封装为 Windows 桌面程序的需求，同时覆盖前端页脚作者信息、安装包安装路径选择和多尺寸图标资产要求。

## Glossary

- **System**: VNASeek 当前仓库中的视频解析应用及新增的 Windows 桌面封装。
- **Web Application**: `beat_analyzer/` 目录中的现有 FastAPI + 原生前端应用。
- **Desktop Shell**: 新增的 Windows 桌面外壳，用于启动本地服务并承载 Web 界面。
- **Installer**: 用于安装 Windows 桌面程序的安装包。
- **Brand Footer**: Web 页面底部的作者、邮箱和仓库信息展示区。
- **Icon Set**: 用于应用窗口、安装包、开始菜单、桌面快捷方式和任务栏的一组图标资源。

## Requirements

### Requirement 1

**User Story:** AS 项目维护者, I want Windows 桌面版与现有 Web 项目解耦, so that 我可以继续维护 Web 版本而不引入回归风险。

#### Acceptance Criteria

1. The System SHALL 保留 `beat_analyzer/` 作为现有 Web Application 的独立运行目录。
2. WHEN 开发 Windows 桌面版, the System SHALL 通过新增独立目录承载 Desktop Shell，而不是重写现有 Web Application。
3. WHEN Desktop Shell 启动, the System SHALL 启动本地后端服务并在应用窗口中加载本地 Web 界面。
4. IF Desktop Shell 启动失败, the System SHALL 向用户展示可理解的启动失败信息。

### Requirement 2

**User Story:** AS Windows 用户, I want 安装桌面版时自行选择安装路径, so that 我可以按本机磁盘规划安装应用。

#### Acceptance Criteria

1. WHEN 用户运行 Installer, the System SHALL 提供安装路径选择能力。
2. WHEN 用户修改安装路径, the Installer SHALL 使用用户选择的目标目录完成安装。
3. IF 用户未修改安装路径, the Installer SHALL 提供默认安装路径并允许继续安装。
4. WHEN 安装完成, the Installer SHALL 生成可正常启动 Desktop Shell 的应用入口。

### Requirement 3

**User Story:** AS Web 或桌面版用户, I want 在页面底部看到作者与项目信息, so that 我可以快速识别维护者并访问项目仓库。

#### Acceptance Criteria

1. The Web Application SHALL 在页面底部展示作者信息区域。
2. The Brand Footer SHALL 展示作者 `猫仙森MRCAT`。
3. The Brand Footer SHALL 展示邮箱 `valnebine@163.com`。
4. The Brand Footer SHALL 展示仓库地址 `https://github.com/valenbine/VnaSeek`。
5. WHEN 用户点击仓库地址, the System SHALL 打开可访问的 GitHub 仓库链接。

### Requirement 4

**User Story:** AS 项目维护者, I want 一组适用于安装包与应用本体的多尺寸图标, so that 桌面版在安装、启动和系统展示时保持统一品牌形象。

#### Acceptance Criteria

1. The System SHALL 定义一套统一的图标视觉主题。
2. The Icon Set SHALL 覆盖至少 `16x16`、`24x24`、`32x32`、`48x48`、`64x64`、`128x128`、`256x256` 和 `512x512` 尺寸。
3. The Icon Set SHALL 支持生成 Windows `ico` 资源。
4. The Icon Set SHALL 支持生成安装包和应用文档所需的 `png` 资源。
5. WHEN 图标用于深色或浅色系统背景, the Icon Set SHALL 保持主体可辨识性。

### Requirement 5

**User Story:** AS 项目维护者, I want 桌面版在本地处理敏感解析流程, so that 涉及本地 cookie 的能力不需要上传到远程服务。

#### Acceptance Criteria

1. WHILE System 运行为 Desktop Shell, the System SHALL 允许本地后端处理解析流程。
2. WHEN 用户在 Desktop Shell 中选择本地 cookie 文件, the System SHALL 仅在本机环境使用该文件。
3. IF 桌面版未启用远程服务, the System SHALL 不将本地 cookie 文件上传至第三方服务器。
