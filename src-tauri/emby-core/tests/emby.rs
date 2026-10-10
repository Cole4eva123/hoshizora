//! `Emby` through its interface, against a stand-in Emby server on 127.0.0.1.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use emby_core::{Emby, Error, Form, Item, Library, Page, Server, Sort, Status, Tmdb};
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
