import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopRoot = path.resolve(__dirname, "..");

let mainWindow = null;
let backendProcess = null;

function detectPythonCommand() {
  if (process.env.VNASEEK_PYTHON) {
    return process.env.VNASEEK_PYTHON;
  }
  return process.platform === "win32" ? "python" : "python3";
}

function resolveDevBackend() {
  const backendDir = path.resolve(desktopRoot, "../beat_analyzer");
  return {
    cwd: backendDir,
    program: detectPythonCommand(),
    args: [path.join(backendDir, "backend.py")],
    mode: "development"
  };
}

function resolvePackagedBackend() {
  const resourcesDir = process.resourcesPath;
  const launcher = path.join(resourcesDir, "launch_backend.py");
  const embeddedPython = process.platform === "win32"
    ? path.join(resourcesDir, "python", "python.exe")
    : path.join(resourcesDir, "python", "bin", "python3");

  return {
    cwd: resourcesDir,
    program: embeddedPython,
    args: [launcher],
    mode: "packaged"
  };
}

function resolveBackendCommand() {
  const packaged = resolvePackagedBackend();
  if (app.isPackaged) {
    return packaged;
  }
  return resolveDevBackend();
}

function startBackend() {
  const command = resolveBackendCommand();
  backendProcess = spawn(command.program, command.args, {
    cwd: command.cwd,
    stdio: "inherit"
  });

  backendProcess.on("exit", (code, signal) => {
    backendProcess = null;
    if (!app.isQuiting && code !== 0) {
      console.error(`VNASeek backend exited unexpectedly. mode=${command.mode} code=${code} signal=${signal}`);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: "VNASeek视频解析",
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 720,
    autoHideMenuBar: true,
    backgroundColor: "#0f172a",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(desktopRoot, "app", "index.html"));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function stopBackend() {
  if (!backendProcess) {
    return;
  }

  backendProcess.kill();
  backendProcess = null;
}

app.on("ready", () => {
  startBackend();
  createWindow();
});

app.on("before-quit", () => {
  app.isQuiting = true;
  stopBackend();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
