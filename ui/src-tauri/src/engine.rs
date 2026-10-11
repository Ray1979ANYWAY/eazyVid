// eazyVid 引擎桥接：spawn Python engine_rpc.py（stdio JSON 行协议）
// 前端 invoke engine_send → 写入 python stdin；python stdout 逐行 emit 到前端 "engine:event"
use std::io::Write;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub struct Engine {
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
}

impl Default for Engine {
    fn default() -> Self {
        Engine {
            stdin: Mutex::new(None),
            child: Mutex::new(None),
        }
    }
}

const PYTHON: &str = r"D:\Program Files\Python\Python310\python.exe";
const SCRIPT: &str = r"D:\Documents\eazyVid\engine_rpc.py";
// CREATE_NO_WINDOW(0x08000000) | BELOW_NORMAL_PRIORITY_CLASS(0x00004000)
const CREATE_FLAGS: u32 = 0x0800_0000 | 0x0000_4000;

impl Engine {
    pub fn spawn(app: &AppHandle) -> Result<(), String> {
        let mut child = Command::new(PYTHON)
            .arg("-X")
            .arg("utf8")
            .arg(SCRIPT)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .creation_flags(CREATE_FLAGS)
            .spawn()
            .map_err(|e| {
                let _ = std::fs::write(r"D:\Documents\eazyVid\tmp\engine_spawn_err.txt",
                                       format!("{e}\n"));
                format!("spawn 引擎失败: {e}")
            })?;
        let stdout = child.stdout.take().ok_or("引擎无 stdout")?;
        let stdin = child.stdin.take().ok_or("引擎无 stdin")?;

        // stdout 逐行转发到前端（长任务事件流）
        let app2 = app.clone();
        std::thread::spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(stdout);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                if !line.trim().is_empty() {
                    let _ = app2.emit("engine:event", line);
                }
            }
            let _ = app2.emit("engine:event", "__eof__");
        });

        // stderr 转发（引擎异常时的诊断线索）+ 落盘探针（GUI 无 console，stderr 不可见）
        if let Some(stderr) = child.stderr.take() {
            let app3 = app.clone();
            std::thread::spawn(move || {
                use std::io::BufRead;
                let reader = std::io::BufReader::new(stderr);
                for line in reader.lines() {
                    let Ok(line) = line else { break };
                    let _ = std::fs::write(r"D:\Documents\eazyVid\tmp\engine_stderr.txt",
                                           format!("{line}\n"));
                    let _ = app3.emit("engine:stderr", line);
                }
            });
        }

        let st: State<'_, Engine> = app.state();
        *st.stdin.lock().unwrap() = Some(stdin);
        *st.child.lock().unwrap() = Some(child);
        Ok(())
    }

    pub fn send(app: &AppHandle, line: &str) -> Result<(), String> {
        /* 落盘探针：前端每个命令（含 diag）是否真正到达 Rust → 判断 onClick 是否触发 */
        use std::time::{SystemTime, UNIX_EPOCH};
        let ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(r"D:\Documents\eazyVid\tmp\engine_ui_commands.txt")
            .and_then(|mut f| {
                f.write_all(format!("{ms}\t{line}\n").as_bytes())
            });
        let st: State<'_, Engine> = app.state();
        let mut guard = st.stdin.lock().unwrap();
        let stdin = guard.as_mut().ok_or("引擎未启动")?;
        stdin
            .write_all(line.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .and_then(|_| stdin.flush())
            .map_err(|e| format!("写入引擎失败: {e}"))
    }

    /// 优雅退出：先发 quit 让 Python 清理子进程，再 taskkill /T /F 兜底（含 yt-dlp/ffmpeg 进程树）
    pub fn shutdown(app: &AppHandle) {
        let st: State<'_, Engine> = app.state();
        if let Some(mut stdin) = st.stdin.lock().unwrap().take() {
            let _ = stdin.write_all(b"{\"cmd\":\"quit\"}\n");
            let _ = stdin.flush();
            drop(stdin);
        }
        let child = st.child.lock().unwrap().take();
        if let Some(c) = child {
            // 给 python 一点时间优雅清理（删 tmp、杀 yt-dlp/ffmpeg 子进程）
            std::thread::sleep(std::time::Duration::from_millis(600));
            // taskkill /T /F 兜底：连 yt-dlp/ffmpeg 子进程树一起清
            let _ = Command::new("taskkill")
                .args(["/PID", &c.id().to_string(), "/T", "/F"])
                .creation_flags(CREATE_FLAGS)
                .output();
        }
    }
}

#[tauri::command]
pub fn engine_send(app: AppHandle, line: String) -> Result<(), String> {
    Engine::send(&app, &line)
}

#[tauri::command]
pub fn engine_restart(app: AppHandle) -> Result<(), String> {
    Engine::shutdown(&app);
    Engine::spawn(&app)
}
