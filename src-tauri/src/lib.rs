// The app's shell: the window over the web app, Emby (emby-core) for its pages, and the player (player/), which plays in
// a window of its own.
mod player;

use emby_core::{Emby, Episode, Error, Form, Kind, Library, Page, Server, Sort, Source, Status, Version};
use player::{Command, Picks, Player};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

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

// Why player_open couldn't play: what Emby said, as the pages read it (EmbyError), or `{ kind: "player" }` when the
// player itself couldn't start.
#[derive(Serialize)]
#[serde(untagged)]
enum Failed {
    Emby(Error),
    Player { kind: &'static str },
}

// Plays a version of a 作品 (a movie, an episode) in the player's window, from where the user left off, on the 音轨 and
// 字幕 picked (by their index in the file; none to leave them to the file); the page names it for the window's title.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn player_open(
    app: AppHandle,
    emby: State<'_, Emby>,
    server: String,
    user: String,
    item: String,
    version: String,
    title: String,
    audio: Option<i64>,
    subtitle: Option<i64>,
) -> Result<(), Failed> {
    let play = emby.play(&server, &user, &item, &version).await.map_err(Failed::Emby)?;
    player::open(&app, play, title, Picks { audio, subtitle }).await.map_err(|e| {
        eprintln!("player: {e}");
        Failed::Player { kind: "player" }
    })
}

// The player's page asks how playing goes as it opens, and hears of each change after (player://state).
#[tauri::command]
fn player_state(player: State<'_, Player>) -> player::State {
    player.state()
}

// what's asked of mpv queued, done in order off the main thread, as mpv may take its time to answer
#[tauri::command]
fn player_command(app: AppHandle, player: State<'_, Player>, command: Command) {
    player.command(&app, command)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // the servers are kept with the app's data, ~/Library/Application Support/<identifier>/ on a Mac
            app.manage(Emby::open(app.path().app_data_dir()?.join("emby.json")));
            app.manage(Player::default());
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
            emby_versions,
            player_open,
            player_state,
            player_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
