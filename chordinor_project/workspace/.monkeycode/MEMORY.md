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

[按上述格式记录的记忆条目]

### KeyBeat 仓库确认
- Date: 2026-04-27
- Context: 用户确认 Chordinor 后续要评估接入 KeyBeat 时提供仓库地址
- Instructions:
  - 用户确认 KeyBeat 仓库为 `https://github.com/therealtxr/keybeat`。
  - KeyBeat 的 PyPI 包名为 `keybeat-txrr`，核心 API 为 `from keybeat import analyze_audio`，返回 `bpm, key, mode`。
  - 后续若接入 KeyBeat，应作为本地 BPM 和调性候选来源参与融合，不替代现有 librosa、Essentia、Aubio 或 Chordino 主流程。

### Chordinor 音频分析路线调整
- Date: 2026-04-27
- Context: 用户要求放弃 KeyBeat，仅加入 Aubio，并重新规划综合音频特征与和弦识别顺序
- Instructions:
  - 不要接入 KeyBeat；Aubio 只作为 BPM 和 beat 候选来源参与融合。
  - 最终分析流程应调整为后端收到上传音频后，先综合分析 librosa BPM/beat/key、Essentia BPM/beat/beat confidence、Aubio BPM/beat，融合得到 bpm、beatTimes、downbeatTimes、timeSignature、key、bpmCandidates、keyCandidates，再运行 Chordino 分析和弦，前端展示统一结果。
  - 走带条应增加当前和弦显示或悬浮详情，不恢复底部和弦片段列表。
  - 和弦片段很多时应考虑走带条虚拟化或 Canvas 渲染提升性能。
  - 移调后的 JSON 文件名应追加移调后缀，例如 `song-transpose-plus-2.json`。
  - 斜杠和弦移调时 bass note 也要随 root 一起移调，例如 `C/E` 升两个半音应为 `D/F#`。
  - `requirements.txt` 应显式加入 NumPy 兼容范围或当前版本约束。
  - 后续应输出真实 `beatTimes` 和 `barLines`，并在走带条展示节拍线和小节线。
  - 拍号估算仍是启发式，需要提供更可靠的改进方案并明确置信度来源。
  - 需要过滤短于一拍的和弦片段：若短片段在第一拍附近，用后方和弦补拍；否则优先用前方和弦补拍。实现时应优先使用融合后的 beat 网格而不是简单 `总时间/总拍数`，因为总拍数不准确会放大误差。

### Chordinor Aubio 安装要求
- Date: 2026-04-27
- Context: Agent 在执行 Aubio provider 接入和接口验证时发现
- Category: 环境配置
- Instructions:
  - `aubio` Python 包在当前环境会从源码编译，安装前需要系统包 `python3-dev` 提供 `Python.h`。
  - 当前环境已通过 `pip install --break-system-packages aubio` 安装 `aubio==0.4.9`，并已验证 `analyze_audio.py` 的 `bpmCandidates` 和 `beatCandidates` 可输出 `aubio` 来源。

### 静态 Web 应用运行方式
- Date: 2026-04-25
- Context: Agent 在执行 Chordino 音乐和弦识别 Web 应用开发时发现并更新
- Category: 构建方法
- Instructions:
  - 当前项目是 Node.js 前后端一体服务，可通过 `npm start` 在仓库根目录启动预览，默认端口为 8000。
  - 后端入口位于 `server.js`，提供 `/api/health` 和 `/api/analyze`，并默认调用工作区 `.runtime/tools/sonic-annotator-1.7.0-linux64-static/squashfs-root/usr/bin/sonic-annotator` 加载 `.runtime/vamp/nnls-chroma.so` 的原生 Vamp Chordino 插件。
  - 原生 Chordino 工具链可通过 `scripts/setup-chordino.sh` 重新生成；该脚本下载官方 sonic-annotator 和 Vamp Plugin Pack，并提取 `nnls-chroma.so`，使 `/api/health` 返回可用。
  - 歌曲调性、BPM、拍号使用 `/api/audio-features` 调用 `analyze_audio.py` 的本地分析；`/api/song-meta` 只合并文件名解析与本地分析来源展示，不再调用 Spotify、SongBPM、iTunes 或 MusicBrainz。
  - librosa 用于 BPM 和调性估算；拍号优先使用 Essentia `RhythmExtractor2013(method="multifeature")` 的 beat 序列和重音周期启发式估算，Essentia 不可用或失败时回退到 librosa beat 序列。
  - 浏览器端回退识别逻辑位于 `src/chordino.js`，页面交互位于 `src/main.js`，样式位于 `styles.css`。
