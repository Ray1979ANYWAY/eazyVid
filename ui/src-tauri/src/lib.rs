mod engine;

use engine::Engine;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Engine::default())
        .setup(|app| {
            if let Err(e) = Engine::spawn(app.handle()) {
                eprintln!("引擎启动失败: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, engine::engine_send, engine::engine_restart])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            Engine::shutdown(app_handle);
        }
    });
}
