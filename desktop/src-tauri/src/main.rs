use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};

use tauri::{path::BaseDirectory, Manager, WebviewUrl, WebviewWindowBuilder};

static BACKEND_CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

fn dev_backend_script_path() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let script = manifest_dir.join("../../beat_analyzer/backend.py");
    script
        .canonicalize()
        .map_err(|error| format!("无法定位 backend.py: {error}"))
}

fn dev_backend_dir() -> Result<PathBuf, String> {
    let script = dev_backend_script_path()?;
    script
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| String::from("backend.py 缺少父目录"))
}

fn python_command() -> String {
    std::env::var("VNASEEK_PYTHON").unwrap_or_else(|_| {
        if cfg!(target_os = "windows") {
            String::from("python")
        } else {
            String::from("python3")
        }
    })
}

fn start_command(program: &Path, script: &Path, current_dir: &Path) -> Result<Child, String> {
    Command::new(program)
        .arg(script)
        .current_dir(current_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| format!("启动本地后端失败: {error}"))
}

fn start_backend(app: &tauri::App) -> Result<Child, String> {
    if let Ok(resource_dir) = app.path().resolve(".", BaseDirectory::Resource) {
        let launcher = resource_dir.join("launch_backend.py");
        let embedded_python = if cfg!(target_os = "windows") {
            resource_dir.join("python/python.exe")
        } else {
            resource_dir.join("python/bin/python3")
        };

        if launcher.exists() && embedded_python.exists() {
            return start_command(&embedded_python, &launcher, &resource_dir);
        }
    }

    let script = dev_backend_script_path()?;
    let app_dir = dev_backend_dir()?;
    let python = PathBuf::from(python_command());
    start_command(&python, &script, &app_dir)
}

fn stop_backend() {
    if let Some(holder) = BACKEND_CHILD.get() {
        if let Ok(mut guard) = holder.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
            *guard = None;
        }
    }
}

fn main() {
    BACKEND_CHILD.get_or_init(|| Mutex::new(None));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let backend_child = start_backend(app)?;
            if let Some(holder) = BACKEND_CHILD.get() {
                if let Ok(mut guard) = holder.lock() {
                    *guard = Some(backend_child);
                }
            }

            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("VNASeek视频解析")
                .inner_size(1280.0, 860.0)
                .min_inner_size(1024.0, 720.0)
                .resizable(true)
                .build()
                .map_err(|error| error.to_string())?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build VNASeek desktop shell")
        .run(|app_handle, event| match event {
            tauri::RunEvent::Exit => stop_backend(),
            tauri::RunEvent::WindowEvent { label, event, .. } => {
                if label == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                    stop_backend();
                    let _ = app_handle.cleanup_before_exit();
                }
            }
            _ => {}
        });
}
