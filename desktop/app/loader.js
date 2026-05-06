const BACKEND_ORIGIN = "http://127.0.0.1:5000";
const HEALTH_URL = `${BACKEND_ORIGIN}/api/health`;
const APP_URL = `${BACKEND_ORIGIN}/`;
const statusTitle = document.querySelector("#status-title");
const statusCopy = document.querySelector("#status-copy");

async function waitForBackend() {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    statusTitle.textContent = "正在等待本地后端";
    statusCopy.textContent = `第 ${attempt} 次检查：${HEALTH_URL}`;

    try {
      const response = await fetch(HEALTH_URL, { cache: "no-store" });
      const payload = await response.json();
      if (response.ok && payload?.ok) {
        statusTitle.textContent = "本地服务已就绪";
        statusCopy.textContent = "正在进入 VNASeek 主界面。";
        window.location.replace(APP_URL);
        return;
      }
    } catch {
      // Ignore and retry until timeout.
    }

    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }

  statusTitle.textContent = "本地服务启动失败";
  statusCopy.textContent = "未能在预期时间内连接本地后端。请检查 Python 环境和日志输出。";
}

waitForBackend();
