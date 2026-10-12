// The app's shell: the window over the web app, and Emby (emby-core) for its pages. Playback moves in here next
// (docs/playback-plan.md).
use emby_core::{Emby, Episode, Error, Form, Kind, Library, Page, Server, Sort, Source, Status, Version};
use tauri::{Manager, State};

// What the pages ask of Emby (src/lib/emby.ts), one command for each thing emby-core does, and nothing more: the
// token stays on this side.

// async, as a command that isn't runs on the main thread, where waiting out an add's write would hold up the window
#[tauri::command]
async fn emby_servers(emby: State<'_, Emby>) -> Result<Vec<Server>, Error> {
    Ok(emby.servers())
}

#[tauri::command]
async fn emby_add(emby: State<'_, Emby>, form: Form) -> Result<Server, Error> {
    emby.add(&form).await
}

#[tauri::command]
async fn emby_edit(emby: State<'_, Emby>, server: String, user: String, form: Form) -> Result<Server, Error> {
    emby.edit(&server, &user, &form).await
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
    sort: Sort,
    start: u32,
    limit: u32,
) -> Result<Page, Error> {
    emby.items(&server, &user, &library, sort, start, limit).await
}

#[tauri::command]
async fn emby_sources(
    emby: State<'_, Emby>,
    server: String,
    user: String,
    media_type: Kind,
    id: u64,
) -> Result<Vec<Source>, Error> {
    emby.sources(&server, &user, media_type, id).await
}

#[tauri::command]
async fn emby_episodes(
    emby: State<'_, Emby>,
    server: String,
    user: String,
    series: String,
    season: u32,
) -> Result<Vec<Episode>, Error> {
    emby.episodes(&server, &user, &series, season).await
}

#[tauri::command]
async fn emby_versions(
    emby: State<'_, Emby>,
    server: String,
    user: String,
    item: String,
) -> Result<Vec<Version>, Error> {
    emby.versions(&server, &user, &item).await
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
            emby_edit,
            emby_remove,
            emby_status,
            emby_libraries,
            emby_items,
            emby_sources,
            emby_episodes,
            emby_versions
        ])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
