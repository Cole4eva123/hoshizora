//! `Emby` through its interface, against a stand-in Emby server on 127.0.0.1.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use emby_core::{Emby, Error, Form, Item, Library, Page, Server, Sort, Source, Status, Tmdb, Track, Version, Video};
use serde_json::{Value, json};

// What the stand-in server handed out and was told.
#[derive(Default)]
struct Seen {
    // the server's id, "srv" unless a test makes it another server
    id: Option<&'static str>,
    issued: u32,
    // the tokens it still takes
    tokens: Vec<String>,
    logged_out: Vec<String>,
    // where the 媒体库 and System/Info have moved to, as a proxy might redirect them
    moved_to: Option<String>,
    // whether what's in front of the server now turns the app away (403)
    refused: bool,
    // what the last list of 作品 was asked with
    items_asked: HashMap<String, String>,
}
type Shared = Arc<Mutex<Seen>>;

fn token(headers: &HeaderMap) -> Option<&str> {
    headers.get("X-Emby-Token").and_then(|v| v.to_str().ok())
}

// A request from a signed-in user, by the token in its header.
fn signed_in(seen: &Shared, headers: &HeaderMap) -> bool {
    token(headers).is_some_and(|t| seen.lock().unwrap().tokens.iter().any(|x| x == t))
}

async fn info(State(seen): State<Shared>) -> Json<Value> {
    let id = seen.lock().unwrap().id.unwrap_or("srv");
    Json(json!({ "Id": id, "ServerName": "宸澄", "Version": "4.9.5.0" }))
}

async fn authenticate(State(seen): State<Shared>, headers: HeaderMap, Json(body): Json<Value>) -> Response {
    // Emby wants to know which device signs in
    let who = headers.get("X-Emby-Authorization").and_then(|v| v.to_str().ok()).unwrap_or_default();
    if !who.contains(r#"DeviceId=""#) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    if body["Username"] == "broken" {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    // bin, and guest, who has no password
    let user = match (body["Username"].as_str(), body["Pw"].as_str()) {
        (Some("bin"), Some("pw")) => json!({ "Id": "u1", "Name": "bin" }),
        (Some("guest"), Some("")) => json!({ "Id": "u2", "Name": "guest" }),
        _ => return StatusCode::UNAUTHORIZED.into_response(),
    };
    let mut seen = seen.lock().unwrap();
    seen.issued += 1;
    let token = format!("token-{}", seen.issued);
    seen.tokens.push(token.clone());
    Json(json!({ "AccessToken": token, "User": user })).into_response()
}

async fn system_info(State(seen): State<Shared>, headers: HeaderMap) -> Response {
    if let Some(to) = seen.lock().unwrap().moved_to.clone() {
        return Redirect::temporary(&to).into_response();
    }
    if seen.lock().unwrap().refused {
        return StatusCode::FORBIDDEN.into_response();
    }
    if !signed_in(&seen, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    Json(json!({ "Id": "srv", "ServerName": "宸澄" })).into_response()
}

async fn views(State(seen): State<Shared>, headers: HeaderMap) -> Response {
    if let Some(to) = seen.lock().unwrap().moved_to.clone() {
        return Redirect::temporary(&to).into_response();
    }
    if !signed_in(&seen, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    Json(json!({ "Items": [
        { "Id": "3", "Name": "剧集", "CollectionType": "tvshows", "ImageTags": { "Primary": "b" } },
        { "Id": "9", "Name": "音乐", "CollectionType": "music", "ImageTags": { "Primary": "c" } },
        { "Id": "1", "Name": "电影", "CollectionType": "movies" },
        { "Id": "5", "Name": "合集", "CollectionType": "boxsets" },
        { "Id": "7", "Name": "混合" },
    ], "TotalRecordCount": 5 }))
    .into_response()
}

async fn items(State(seen): State<Shared>, headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Response {
    if !signed_in(&seen, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    seen.lock().unwrap().items_asked = q.clone();
    // a 作品's 片源, by its TMDB entry
    if let Some(id) = q.get("AnyProviderIdEquals") {
        let items = match (id.as_str(), q["IncludeItemTypes"].as_str()) {
            ("Tmdb.278236", "Movie") => vec![
                json!({ "Id": "m1", "Name": "X加Y", "ProviderIds": { "Tmdb": "278236" },
                        "MediaSources": [read_version()] }),
            ],
            ("Tmdb.596881", "Movie") => vec![
                json!({ "Id": "m2", "Name": "春江水暖", "ProviderIds": { "Tmdb": "596881" },
                        "MediaSources": [unread_version()] }),
            ],
            // a server that ignores AnyProviderIdEquals, its whole library answering
            ("Tmdb.7", "Movie") => vec![json!({ "Id": "m9", "Name": "别的", "ProviderIds": { "Tmdb": "8" } })],
            // kept twice, the copy with no episodes first; its seasons counted only with its user data, as Emby does
            ("Tmdb.68507", "Series") => {
                let seasons = if q.get("EnableUserData").map(String::as_str) == Some("false") { 0 } else { 3 };
                let tmdb = json!({ "Tmdb": "68507" });
                vec![
                    json!({ "Id": "s0", "Name": "黑暗物质三部曲", "ProviderIds": tmdb, "ChildCount": 0 }),
                    json!({ "Id": "s1", "Name": "黑暗物质", "ProviderIds": tmdb, "ChildCount": seasons }),
                ]
            }
            _ => vec![],
        };
        return Json(json!({ "Items": items, "TotalRecordCount": items.len() })).into_response();
    }
    let all = if q["ParentId"] == "1" {
        vec![
            json!({ "Id": "a", "Name": "三国", "Type": "Series", "ProductionYear": 2010, "ImageTags": { "Primary": "t" }, "ProviderIds": { "Tmdb": "40052" } }),
            json!({ "Id": "b", "Name": "戒灵", "Type": "Movie", "ProviderIds": { "Imdb": "tt1" } }),
            json!({ "Id": "c", "Name": "沙丘", "Type": "Movie", "ProductionYear": 2021, "ProviderIds": { "Tmdb": "438631" } }),
        ]
    } else {
        vec![]
    };
    let start: usize = q["StartIndex"].parse().unwrap();
    let limit: usize = q["Limit"].parse().unwrap();
    // Emby counts them only when asked to
    let total = if q["EnableTotalRecordCount"] == "true" { all.len() } else { 0 };
    let page: Vec<_> = all.into_iter().skip(start).take(limit).collect();
    Json(json!({ "Items": page, "TotalRecordCount": total })).into_response()
}

// A version the server has read: a 4K file with two 音轨 and two 字幕, and a cover picture, which isn't a track.
fn read_version() -> Value {
    json!({ "Id": "v1", "Name": "2160p - BluRay", "Size": 21_800_000_000u64, "Bitrate": 30_481_253,
        "Path": "/mnt/movies/X加Y #1 (2014)/X+Y.2014.2160p.BluRay.x265.10bit.DTS-HD.MA.7.1-SWTYBLZ.mkv", "MediaStreams": [
        { "Type": "Video", "Index": 0, "Codec": "hevc", "Width": 3840, "Height": 1600, "VideoRange": "HDR 10" },
        { "Type": "Audio", "Index": 1, "Codec": "dts", "Language": "eng", "Channels": 8, "IsDefault": true },
        { "Type": "Audio", "Index": 2, "Codec": "ac3", "Language": "eng", "Title": "Commentary", "Channels": 2 },
        { "Type": "Subtitle", "Index": 3, "Codec": "subrip", "Language": "eng", "Title": "Forced SRT",
          "IsDefault": true, "IsForced": true },
        { "Type": "Subtitle", "Index": 4, "Codec": "ass", "Language": "chi", "Title": "chs" },
        { "Type": "EmbeddedImage", "Index": 5, "Codec": "mjpeg" },
    ]})
}

// A .strm the server hasn't read: nothing known of it but its name and its link.
fn unread_version() -> Value {
    json!({ "Id": "v2", "Name": "1080p - BluRay", "Size": 0, "MediaStreams": [],
        "Path": "https://drive.example/d/%E6%98%A5%E6%B1%9F.1080p.BluRay.mkv?sign=secret#t=0" })
}

// A season of a series' 片源, as Emby numbers it.
async fn episodes(
    State(seen): State<Shared>,
    headers: HeaderMap,
    Path(series): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    if !signed_in(&seen, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    seen.lock().unwrap().items_asked = q.clone();
    let mut items = if series == "s1" && q.get("Season").map(String::as_str) == Some("2") {
        // and one file holding two, and one the server hasn't numbered
        vec![
            json!({ "Id": "e21", "ParentIndexNumber": 2, "IndexNumber": 1, "MediaSources": [unread_version()] }),
            json!({ "Id": "e24", "ParentIndexNumber": 2, "IndexNumber": 4, "IndexNumberEnd": 5,
                    "MediaSources": [unread_version()] }),
            json!({ "Id": "e2x", "ParentIndexNumber": 2 }),
        ]
    } else {
        vec![]
    };
    // a server set to show missing episodes lists them, with no file, unless asked not to; and next week's, not yet
    // missing, either way
    if !items.is_empty() && q.get("IsMissing").map(String::as_str) != Some("false") {
        items.push(json!({ "Id": "e22", "ParentIndexNumber": 2, "IndexNumber": 2, "LocationType": "Virtual" }));
    }
    if !items.is_empty() {
        items.push(json!({ "Id": "e23", "ParentIndexNumber": 2, "IndexNumber": 3, "LocationType": "Virtual" }));
    }
    Json(json!({ "Items": items })).into_response()
}

// What a version holds: read from the file, as for playback, when the server hasn't yet; otherwise what it has.
async fn playback_info(
    State(seen): State<Shared>,
    headers: HeaderMap,
    Path(item): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    if !signed_in(&seen, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let is = |k: &str, v: &str| q.get(k).map(String::as_str) == Some(v);
    let read = is("IsPlayback", "true") && is("AutoOpenLiveStream", "false") && is("UserId", "u1");
    let version = if read {
        json!({ "Id": "v2", "Name": "1080p - BluRay", "Bitrate": 5_382_534,
            "Path": "D:\\Movies\\Dwelling.in.the.Fuchun.Mountains.2019.1080p.mkv", "MediaStreams": [
            { "Type": "Video", "Index": 0, "Codec": "hevc", "Width": 1920, "Height": 1080, "VideoRange": "SDR" },
            { "Type": "Audio", "Index": 1, "Codec": "ac3", "Channels": 6, "IsDefault": true },
            { "Type": "Subtitle", "Index": 2, "Codec": "PGSSUB", "Language": "chi", "Title": "chs", "IsDefault": true },
        ]})
    } else {
        unread_version()
    };
    let sources = if item == "m2" { vec![version] } else { vec![] };
    Json(json!({ "MediaSources": sources, "PlaySessionId": "p" })).into_response()
}

async fn logout(State(seen): State<Shared>, headers: HeaderMap) -> StatusCode {
    let mut seen = seen.lock().unwrap();
    if let Some(t) = token(&headers) {
        seen.tokens.retain(|x| x != t);
        seen.logged_out.push(t.to_owned());
    }
    StatusCode::NO_CONTENT
}

// A stand-in Emby on a port of its own, under /emby as a real one answers, and the host and port to type for it.
// /moved redirects to it, as a reverse proxy might, with a slash on the end.
async fn emby() -> (String, Shared) {
    let seen = Shared::default();
    let app = Router::new()
        .route("/emby/System/Info/Public", get(info))
        .route("/emby/System/Info/Public/", get(info))
        .route("/moved/emby/System/Info/Public", get(|| async { Redirect::permanent("/emby/System/Info/Public/") }))
        .route("/emby/Users/AuthenticateByName", post(authenticate))
        .route("/emby/System/Info", get(system_info))
        .route("/emby/Users/u1/Views", get(views))
        .route("/emby/Users/u1/Items", get(items))
        .route("/emby/Shows/{series}/Episodes", get(episodes))
        .route("/emby/Items/{item}/PlaybackInfo", post(playback_info))
        .route("/emby/Sessions/Logout", post(logout))
        .with_state(seen.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let at = listener.local_addr().unwrap().to_string();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (at, seen)
}

// What the dialog sends: the address as typed, the user, the password and the 备注, under the names the page gives
// them (src/lib/emby.ts), so a name that drifts on either side fails here rather than in the app.
fn form(address: &str, username: &str, password: &str, nickname: &str) -> Form {
    serde_json::from_value(json!({ "address": address, "username": username, "password": password, "nickname": nickname }))
        .unwrap()
}

// A file of its own for each test to keep its servers in.
fn file(test: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("emby-core-{}-{test}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir.join("emby.json")
}

// Whether something done in the background (a sign-out) has happened within a second.
async fn eventually(done: impl Fn() -> bool) -> bool {
    for _ in 0..50 {
        if done() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    false
}

#[tokio::test]
async fn adds_a_server_over_http_when_it_has_no_https_and_keeps_it_across_launches() {
    let (at, _) = emby().await;
    let path = file("adds");
    let added = Emby::open(path.clone()).add(&form(&at, "bin", "pw", " 家里 ")).await.unwrap();
    assert_eq!(
        added,
        Server {
            id: "srv".into(),
            name: "宸澄".into(),
            nickname: Some("家里".into()),
            address: format!("http://{at}/emby"),
            user_id: "u1".into(),
            user_name: "bin".into(),
            signed_in: added.signed_in,
        }
    );
    // the next launch has it, signed in with the token kept
    let reopened = Emby::open(path.clone());
    assert_eq!(reopened.servers(), [added]);
    assert_eq!(reopened.status("srv", "u1").await, Status::Online);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    }
}

#[tokio::test]
async fn a_wrong_password_keeps_nothing_and_a_server_error_is_not_taken_for_one() {
    let (at, _) = emby().await;
    let emby = Emby::open(file("wrong"));
    assert_eq!(emby.add(&form(&at, "bin", "nope", "")).await, Err(Error::SignIn));
    assert_eq!(emby.add(&form(&at, "broken", "pw", "")).await, Err(Error::Server { status: 500 }));
    assert_eq!(emby.servers(), []);
}

#[tokio::test]
async fn an_unreadable_file_is_moved_aside_rather_than_written_over() {
    let (at, _) = emby().await;
    let path = file("unreadable");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, "not json").unwrap();
    let emby = Emby::open(path.clone());
    assert_eq!(emby.servers(), []);
    emby.add(&form(&at, "bin", "pw", "")).await.unwrap();
    let aside = std::fs::read_dir(path.parent().unwrap())
        .unwrap()
        .map(|e| e.unwrap().path())
        .find(|p| p.to_string_lossy().contains(".unreadable-"))
        .unwrap();
    assert_eq!(std::fs::read_to_string(aside).unwrap(), "not json");
}

// One that can't be read now (no permission, a disk error) may read again on the next launch, so it stays where it is,
// and nothing is written over it meanwhile.
#[cfg(unix)]
#[tokio::test]
async fn a_file_that_cannot_be_read_is_left_alone_and_not_written_over() {
    use std::os::unix::fs::PermissionsExt;
    let (at, _) = emby().await;
    let path = file("locked");
    Emby::open(path.clone()).add(&form(&at, "bin", "pw", "")).await.unwrap();
    let kept = std::fs::read_to_string(&path).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o000)).unwrap();
    // root reads it anyway, so there's nothing to see
    if std::fs::read(&path).is_ok() {
        return;
    }
    let emby = Emby::open(path.clone());
    assert_eq!(emby.servers(), []);
    assert_eq!(emby.add(&form(&at, "bin", "pw", "")).await, Err(Error::Storage));
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), kept);
    assert_eq!(Emby::open(path).servers().len(), 1);
}

// A write waits on the disk (a fsync, which on a Mac flushes the drive's cache) away from the threads that answer the
// pages. The temporary file is a pipe here, which opening to write waits on until something reads it: it's read once
// something else has run meanwhile on the runtime's one thread, or after 5 s if nothing could.
#[cfg(unix)]
#[tokio::test(flavor = "current_thread")]
async fn a_slow_write_does_not_hold_up_what_else_is_asked() {
    let (at, _) = emby().await;
    let path = file("slow");
    let emby = Arc::new(Emby::open(path.clone()));
    emby.add(&form(&at, "bin", "pw", "")).await.unwrap();
    let tmp = path.with_extension("tmp");
    assert!(std::process::Command::new("mkfifo").arg(&tmp).status().unwrap().success());
    let (ran, running) = std::sync::mpsc::channel();
    let disk = std::thread::spawn(move || {
        let ran_meanwhile = running.recv_timeout(Duration::from_secs(5)).is_ok();
        // opened to read and write, which doesn't wait for a writer, and held till the write is done
        (ran_meanwhile, std::fs::OpenOptions::new().read(true).write(true).open(tmp))
    });
    let writing = tokio::spawn({
        let emby = emby.clone();
        async move { emby.remove("srv", "u1").await }
    });
    // the write starts while this waits, and this runs again only if the write doesn't hold the thread
    tokio::time::sleep(Duration::from_millis(10)).await;
    let _ = ran.send(());
    let _ = writing.await;
    assert!(disk.join().unwrap().0, "nothing else ran while the write waited on the disk");
}

#[tokio::test]
async fn nothing_there_is_offline_and_text_that_is_not_an_address_is_turned_down() {
    // a port nothing listens on any more
    let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap();
    let emby = Emby::open(file("offline"));
    assert_eq!(emby.add(&form(&closed.to_string(), "bin", "pw", "")).await, Err(Error::Offline));
    assert_eq!(emby.add(&form("not an address", "bin", "pw", "")).await, Err(Error::NotAnAddress));
}

#[tokio::test]
async fn follows_a_redirect_and_keeps_the_address_it_landed_at() {
    let (at, _) = emby().await;
    let emby = Emby::open(file("moved"));
    let added = emby.add(&form(&format!("http://{at}/moved"), "bin", "pw", "")).await.unwrap();
    assert_eq!(added.address, format!("http://{at}/emby"));
    assert_eq!(emby.status("srv", "u1").await, Status::Online);
}

#[tokio::test]
async fn signing_in_again_keeps_the_nickname_and_ends_the_old_sign_in() {
    let (at, seen) = emby().await;
    let emby = Emby::open(file("again"));
    emby.add(&form(&at, "bin", "pw", "家里")).await.unwrap();
    let again = emby.add(&form(&at, "bin", "pw", "")).await.unwrap();
    assert_eq!(again.nickname.as_deref(), Some("家里"));
    assert_eq!(emby.servers(), [again]);
    assert!(eventually(|| seen.lock().unwrap().logged_out == ["token-1"]).await);
    assert_eq!(emby.status("srv", "u1").await, Status::Online);
}

#[tokio::test]
async fn status_tells_a_token_turned_down_from_a_server_not_kept() {
    let (at, seen) = emby().await;
    let emby = Emby::open(file("status"));
    emby.add(&form(&at, "bin", "pw", "")).await.unwrap();
    assert_eq!(emby.status("srv", "u1").await, Status::Online);
    // revoked on the server
    seen.lock().unwrap().tokens.clear();
    assert_eq!(emby.status("srv", "u1").await, Status::SignedOut);
    assert_eq!(emby.status("gone", "u1").await, Status::Offline);
}

#[tokio::test]
async fn status_tells_an_address_that_redirects_from_a_user_turned_away() {
    let (at, seen) = emby().await;
    let emby = Emby::open(file("elsewhere"));
    emby.add(&form(&at, "bin", "pw", "")).await.unwrap();
    seen.lock().unwrap().moved_to = Some(format!("https://{at}/emby/System/Info"));
    assert_eq!(emby.status("srv", "u1").await, Status::Moved);
    // to another host, as a café's Wi-Fi sends everything to its sign-in page, nothing Emby answered
    seen.lock().unwrap().moved_to = Some("http://portal.example/login".into());
    assert_eq!(emby.status("srv", "u1").await, Status::Offline);
    // turned away before the token's looked at
    *seen.lock().unwrap() = Seen { refused: true, ..Seen::default() };
    assert_eq!(emby.status("srv", "u1").await, Status::Refused);
}

#[tokio::test]
async fn libraries_are_those_of_movies_and_series_in_the_servers_order_with_covers() {
    let (at, seen) = emby().await;
    let emby = Emby::open(file("libraries"));
    emby.add(&form(&at, "bin", "pw", "")).await.unwrap();
    let cover = format!("http://{at}/emby/Items/3/Images/Primary?tag=b&maxWidth=480&quality=90");
    assert_eq!(
        emby.libraries("srv", "u1").await.unwrap(),
        [
            Library { id: "3".into(), name: "剧集".into(), cover: Some(cover) },
            Library { id: "1".into(), name: "电影".into(), cover: None },
            Library { id: "7".into(), name: "混合".into(), cover: None },
        ]
    );
    assert_eq!(emby.libraries("gone", "u1").await, Err(Error::NoServer));
    seen.lock().unwrap().tokens.clear();
    assert_eq!(emby.libraries("srv", "u1").await, Err(Error::SignedOut));
}

#[tokio::test]
async fn a_signed_in_request_is_not_redirected_with_its_token() {
    let (at, seen) = emby().await;
    let (elsewhere, _) = emby().await;
    let emby = Emby::open(file("redirected"));
    emby.add(&form(&at, "bin", "pw", "")).await.unwrap();
    seen.lock().unwrap().moved_to = Some(format!("http://{elsewhere}/emby/Users/u1/Views"));
    // followed, the other server would turn the token down (SignedOut); not followed, the redirect is the answer
    assert_eq!(emby.libraries("srv", "u1").await, Err(Error::Moved));
}

#[tokio::test]
async fn items_come_a_page_at_a_time_linked_to_tmdb_with_the_count_on_the_first() {
    let (at, _) = emby().await;
    let emby = Emby::open(file("items"));
    emby.add(&form(&at, "bin", "pw", "")).await.unwrap();
    assert_eq!(
        emby.items("srv", "u1", "1", Sort::Added, 0, 2).await.unwrap(),
        Page {
            items: vec![
                Item {
                    id: "a".into(),
                    name: "三国".into(),
                    year: Some(2010),
                    poster: Some(format!("http://{at}/emby/Items/a/Images/Primary?tag=t&maxWidth=342&quality=90")),
                    tmdb: Some(Tmdb { media_type: "tv", id: 40052 }),
                },
                Item { id: "b".into(), name: "戒灵".into(), year: None, poster: None, tmdb: None },
            ],
            total: Some(3),
        }
    );
    let next = emby.items("srv", "u1", "1", Sort::Added, 2, 2).await.unwrap();
    assert_eq!(next.total, None);
    assert_eq!(next.items[0].tmdb, Some(Tmdb { media_type: "movie", id: 438631 }));
}

#[tokio::test]
async fn each_sort_asks_for_its_order_and_by_premiere_only_for_titles_premiered() {
    let (at, seen) = emby().await;
    let emby = Emby::open(file("sorts"));
    emby.add(&form(&at, "bin", "pw", "")).await.unwrap();
    // the names the pages send (src/lib/emby.ts)
    for name in ["added", "latest", "oldest", "rating"] {
        assert!(serde_json::from_value::<Sort>(json!(name)).is_ok(), "{name}");
    }
    for (sort, by, order, premiered) in [
        (Sort::Added, "DateCreated,SortName", "Descending,Ascending", false),
        (Sort::Latest, "PremiereDate,SortName", "Descending,Ascending", true),
        (Sort::Oldest, "PremiereDate,SortName", "Ascending,Ascending", true),
        (Sort::Rating, "CommunityRating,SortName", "Descending,Ascending", false),
    ] {
        emby.items("srv", "u1", "1", sort, 0, 2).await.unwrap();
        let asked = seen.lock().unwrap().items_asked.clone();
        assert_eq!((asked["SortBy"].as_str(), asked["SortOrder"].as_str()), (by, order), "{sort:?}");
        assert_eq!(asked.get("IsUnaired").map(String::as_str), premiered.then_some("false"), "{sort:?}");
        assert_eq!(asked.contains_key("MinPremiereDate"), premiered, "{sort:?}");
    }
}

#[tokio::test]
async fn a_new_address_where_the_same_server_answers_keeps_the_sign_in_and_an_empty_nickname_clears_it() {
    let (at, seen) = emby().await;
    let emby = Emby::open(file("edit-address"));
    let added = emby.add(&form(&at, "bin", "pw", "家里")).await.unwrap();
    // the same server, by another name for its host, and the same user however its name is typed
    let elsewhere = at.replace("127.0.0.1", "localhost");
    let edited = emby.edit("srv", "u1", &form(&elsewhere, " Bin", "", "")).await.unwrap();
    assert_eq!(edited, Server { address: format!("http://{elsewhere}/emby"), nickname: None, ..added });
    assert_eq!(emby.servers(), [edited]);
    assert_eq!(emby.status("srv", "u1").await, Status::Online);
    // neither signed in again nor out
    let seen = seen.lock().unwrap();
    assert_eq!((seen.issued, seen.logged_out.len()), (1, 0));
}

#[tokio::test]
async fn an_edit_that_fails_changes_nothing() {
    let (at, _) = emby().await;
    let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap();
    let emby = Emby::open(file("edit-fails"));
    let added = emby.add(&form(&at, "bin", "pw", "家里")).await.unwrap();
    assert_eq!(emby.edit("srv", "u1", &form(&added.address, "bin", "nope", "")).await, Err(Error::SignIn));
    assert_eq!(emby.edit("srv", "u1", &form(&closed.to_string(), "bin", "", "")).await, Err(Error::Offline));
    assert_eq!(emby.edit("srv", "u1", &form("not an address", "bin", "", "")).await, Err(Error::NotAnAddress));
    assert_eq!(emby.edit("gone", "u1", &form(&added.address, "bin", "", "")).await, Err(Error::NoServer));
    assert_eq!(emby.servers(), [added]);
}

#[tokio::test]
async fn a_password_or_another_server_signs_in_again_in_the_entrys_place_ending_the_old_sign_in() {
    let (at, seen) = emby().await;
    let (other, other_seen) = emby().await;
    // another server, its tokens told apart from the first one's
    *other_seen.lock().unwrap() = Seen { id: Some("other"), issued: 100, ..Default::default() };
    let emby = Emby::open(file("edit-sign-in"));
    let added = emby.add(&form(&at, "bin", "pw", "")).await.unwrap();
    emby.add(&form(&other, "bin", "pw", "")).await.unwrap();
    let again = emby.edit("srv", "u1", &form(&added.address, "bin", "pw", "")).await.unwrap();
    assert_eq!(emby.servers()[0], again);
    assert!(eventually(|| seen.lock().unwrap().logged_out == ["token-1"]).await);
    // another server at the new address is signed in to rather than handed the token: here, with no password
    assert_eq!(emby.edit("srv", "u1", &form(&other, "bin", "", "")).await, Err(Error::SignIn));
    let moved = emby.edit("srv", "u1", &form(&other, "bin", "pw", "")).await.unwrap();
    assert_eq!(moved.id, "other");
    // and it stands for the entry kept for that server already, whose sign-in ends with the one it replaced
    assert_eq!(emby.servers(), [moved]);
    assert!(eventually(|| seen.lock().unwrap().logged_out == ["token-1", "token-2"]).await);
    assert!(eventually(|| other_seen.lock().unwrap().logged_out == ["token-101"]).await);
}

#[tokio::test]
async fn a_sign_in_kept_over_https_is_not_moved_to_http_without_the_password() {
    let (at, _) = emby().await;
    let path = file("downgrade");
    Emby::open(path.clone()).add(&form(&at, "bin", "pw", "")).await.unwrap();
    // as if it had been signed in over https
    let kept = std::fs::read_to_string(&path).unwrap().replace("http://", "https://");
    std::fs::write(&path, kept).unwrap();
    let emby = Emby::open(path);
    let http = format!("http://{at}/emby");
    assert_eq!(emby.edit("srv", "u1", &form(&http, "bin", "", "")).await, Err(Error::SignIn));
    assert_eq!(emby.edit("srv", "u1", &form(&http, "bin", "pw", "")).await.unwrap().address, http);
}

#[tokio::test]
async fn a_sign_in_the_server_turned_down_is_renewed_even_for_a_user_with_no_password() {
    let (at, seen) = emby().await;
    let emby = Emby::open(file("renew"));
    let guest = emby.add(&form(&at, "guest", "", "")).await.unwrap();
    // revoked on the server
    seen.lock().unwrap().tokens.clear();
    assert_eq!(emby.status("srv", "u2").await, Status::SignedOut);
    emby.edit("srv", "u2", &form(&guest.address, "guest", "", "")).await.unwrap();
    assert_eq!(emby.status("srv", "u2").await, Status::Online);
}

// Changes made at once all stand, in the list and the file, as each starts from the one before it.
#[tokio::test(flavor = "multi_thread")]
async fn changes_made_at_once_all_stand() {
    let (at, _) = emby().await;
    let path = file("together");
    let emby = Arc::new(Emby::open(path.clone()));
    emby.add(&form(&at, "bin", "pw", "")).await.unwrap();
    emby.add(&form(&at, "guest", "", "")).await.unwrap();
    let nicknames = |servers: Vec<Server>| servers.into_iter().map(|s| s.nickname).collect::<Vec<_>>();
    for round in 0..20 {
        let edits = [("u1", "bin"), ("u2", "guest")].map(|(user, name)| {
            let (emby, form) = (emby.clone(), form(&format!("http://{at}/emby"), name, "", &format!("{name}{round}")));
            tokio::spawn(async move { emby.edit("srv", user, &form).await })
        });
        for edit in edits {
            edit.await.unwrap().unwrap();
        }
        let both = [Some(format!("bin{round}")), Some(format!("guest{round}"))];
        assert_eq!(nicknames(emby.servers()), both, "round {round}");
        assert_eq!(nicknames(Emby::open(path.clone()).servers()), both, "round {round}");
    }
}

// An 音轨 or a 字幕 as emby-core hands it out.
fn track(
    index: u32,
    codec: &str,
    language: Option<&str>,
    title: Option<&str>,
    channels: Option<u32>,
    flags: (bool, bool),
) -> Track {
    let (default, forced) = flags;
    Track {
        index,
        language: language.map(Into::into),
        title: title.map(Into::into),
        codec: Some(codec.into()),
        channels,
        default,
        forced,
    }
}

#[tokio::test]
async fn a_movies_sources_are_found_by_its_tmdb_entry_with_their_versions_and_tracks() {
    let (at, seen) = emby().await;
    let emby = Emby::open(file("sources"));
    emby.add(&form(&at, "bin", "pw", "")).await.unwrap();
    assert_eq!(
        emby.sources("srv", "u1", "movie", 278236).await.unwrap(),
        [Source {
            item: "m1".into(),
            name: "X加Y".into(),
            seasons: None,
            versions: vec![Version {
                id: "v1".into(),
                name: "2160p - BluRay".into(),
                file: Some("X+Y.2014.2160p.BluRay.x265.10bit.DTS-HD.MA.7.1-SWTYBLZ.mkv".into()),
                bitrate: Some(30_481_253),
                video: Some(Video { width: 3840, height: 1600, range: Some("HDR 10".into()) }),
                audio: vec![
                    track(1, "dts", Some("eng"), None, Some(8), (true, false)),
                    track(2, "ac3", Some("eng"), Some("Commentary"), Some(2), (false, false)),
                ],
                subtitles: vec![
                    track(3, "subrip", Some("eng"), Some("Forced SRT"), None, (true, true)),
                    track(4, "ass", Some("chi"), Some("chs"), None, (false, false)),
                ],
            }],
        }]
    );
    let asked = seen.lock().unwrap().items_asked.clone();
    let asked = [&asked["AnyProviderIdEquals"], &asked["IncludeItemTypes"], &asked["Recursive"]];
    assert_eq!(asked, ["Tmdb.278236", "Movie", "true"]);
    assert_eq!(emby.sources("srv", "u1", "movie", 1).await.unwrap(), []);
    assert_eq!(emby.sources("srv", "u1", "movie", 7).await.unwrap(), []);
    // a .strm the server hasn't read: no picture, bitrate or tracks; its link's name without the drive's signature
    let unread = &emby.sources("srv", "u1", "movie", 596881).await.unwrap()[0].versions[0];
    assert_eq!((unread.bitrate, &unread.video, unread.audio.len()), (None, &None, 0));
    assert_eq!(unread.file.as_deref(), Some("%E6%98%A5%E6%B1%9F.1080p.BluRay.mkv"));
    assert_eq!(emby.sources("gone", "u1", "movie", 278236).await, Err(Error::NoServer));
}

#[tokio::test]
async fn a_series_kept_twice_has_the_copy_with_episodes_first_and_its_episodes_come_a_season_at_a_time() {
    let (at, seen) = emby().await;
    let emby = Emby::open(file("series"));
    emby.add(&form(&at, "bin", "pw", "")).await.unwrap();
    let found = emby.sources("srv", "u1", "tv", 68507).await.unwrap();
    let found: Vec<_> = found.iter().map(|s| (s.item.as_str(), s.seasons)).collect();
    assert_eq!(found, [("s1", Some(3)), ("s0", Some(0))]);
    let episodes = emby.episodes("srv", "u1", "s1", 2).await.unwrap();
    // the one the server hasn't numbered is left out, and those with no file
    let numbers: Vec<_> = episodes.iter().map(|e| (e.item.as_str(), e.season, e.episode, e.last)).collect();
    assert_eq!(numbers, [("e21", 2, 1, None), ("e24", 2, 4, Some(5))]);
    assert_eq!(seen.lock().unwrap().items_asked["Season"], "2");
    // an id that isn't one Emby gives goes into no path
    assert_eq!(emby.episodes("srv", "u1", "../Users", 2).await.unwrap(), []);
}

#[tokio::test]
async fn versions_have_the_server_read_a_file_it_has_not_yet() {
    let (at, _) = emby().await;
    let emby = Emby::open(file("versions"));
    emby.add(&form(&at, "bin", "pw", "")).await.unwrap();
    let read = emby.versions("srv", "u1", "m2").await.unwrap();
    assert_eq!(read[0].video.as_ref().map(|v| v.height), Some(1080));
    // read, it has its bitrate; on a Windows server, its file's name after the last backslash
    assert_eq!(read[0].bitrate, Some(5_382_534));
    assert_eq!(read[0].file.as_deref(), Some("Dwelling.in.the.Fuchun.Mountains.2019.1080p.mkv"));
    assert_eq!(read[0].audio, [track(1, "ac3", None, None, Some(6), (true, false))]);
    assert_eq!(read[0].subtitles[0].title.as_deref(), Some("chs"));
    assert_eq!(emby.versions("srv", "u1", "Items/x").await.unwrap(), []);
}

#[tokio::test]
async fn removing_a_server_forgets_it_and_signs_it_out() {
    let (at, seen) = emby().await;
    let path = file("remove");
    let emby = Emby::open(path.clone());
    emby.add(&form(&at, "bin", "pw", "")).await.unwrap();
    emby.remove("srv", "u1").await.unwrap();
    assert_eq!(emby.servers(), []);
    assert_eq!(Emby::open(path).servers(), []);
    assert!(eventually(|| seen.lock().unwrap().logged_out == ["token-1"]).await);
}
