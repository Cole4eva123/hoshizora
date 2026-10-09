// The app's shell: for now just the window over the web app. Emby and playback move in here next
// (docs/playback-plan.md).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
