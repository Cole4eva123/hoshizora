// The app's shell: the window over the web app, and Emby (emby-core) for its pages. Playback moves in here next
// (docs/playback-plan.md).
use emby_core::{Emby, Error, Library, Page, Server, Status};
use tauri::{Manager, State};

// What the pages ask of Emby (src/lib/emby.ts), one command for each thing emby-core does, and nothing more: the
// token stays on this side.

// async, as a command that isn't runs on the main thread, where waiting out an add's write would hold up the window
#[tauri::command]
async fn emby_servers(emby: State<'_, Emby>) -> Result<Vec<Server>, Error> {
    Ok(emby.servers())
}

#[tauri::command]
async fn emby_add(
    emby: State<'_, Emby>,
    typed: String,
    username: String,
    password: String,
    nickname: String,
) -> Result<Server, Error> {
    emby.add(&typed, &username, &password, &nickname).await
}

#[tauri::command]
async fn emby_remove(emby: State<'_, Emby>, server: String, user: String) -> Result<(), Error> {
    emby.remove(&server, &user).await
}

#[tauri::command]
async fn emby_status(emby: State<'_, Emby>, server: String, user: String) -> Result<Status, Error> {
    Ok(emby.status(&server, &user).await)
}

#[tauri::command]
async fn emby_libraries(emby: State<'_, Emby>, server: String, user: String) -> Result<Vec<Library>, Error> {
    emby.libraries(&server, &user).await
}

#[tauri::command]
async fn emby_items(
    emby: State<'_, Emby>,
    server: String,
    user: String,
    library: String,
    start: u32,
    limit: u32,
) -> Result<Page, Error> {
    emby.items(&server, &user, &library, start, limit).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // the servers are kept with the app's data, ~/Library/Application Support/<identifier>/ on a Mac
            app.manage(Emby::open(app.path().app_data_dir()?.join("emby.json")));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            emby_servers,
            emby_add,
            emby_remove,
            emby_status,
            emby_libraries,
            emby_items
        ])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
