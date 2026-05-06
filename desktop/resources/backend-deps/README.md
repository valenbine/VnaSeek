# Backend Dependency Placeholder

这个目录用于存放桌面安装包随带的 Python 依赖。

推荐构建方式：

1. 在 Windows 构建机中创建干净环境
2. 执行依赖安装到本目录
3. 由 `launch_backend.py` 注入 `sys.path`

参考目标：

```bash
pip install --target ./desktop/resources/backend-deps -r ./beat_analyzer/requirements.txt
```

最终用户不需要手工安装这些依赖。
