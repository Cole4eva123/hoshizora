//! Playing through the 服务器, for a version that can't be played from where it is (a file on its disk, a link on its
//! own network): mpv is given a link on this Mac, and what it asks there is asked of the server's stream of the file as
//! the signed-in user, the answer passed back as it comes. The token stays here, in a header as everywhere, never in a
//! URL nor with mpv; a redirect the server answers with (to a cloud drive, as some do) goes back to mpv as it is, to
//! follow without it.

use std::net::Ipv4Addr;
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::header::{ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, LOCATION, RANGE};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use reqwest::{Client, Request};

use crate::kept::random_id;

// how many links are kept, the last given out: the one playing, and one asked for meanwhile (two 播放 at once, or one
// the player then couldn't open) that it mustn't take the place of
const KEPT: usize = 4;

// what plays through it, by its link's name: the request for the server's stream, its address and token as they were
// ponytail: a sign-in renewed or an address changed mid-film (in the server's settings) leaves that film's next seek
// turned down; ask with the kept server each time if that turns up
type Playing = Arc<Mutex<Vec<(String, Request)>>>;

/// Where mpv asks for what plays through the server: on this Mac only, a link with a name of its own for each.
pub(crate) struct Relay {
    at: String,
    playing: Playing,
}

impl Relay {
    // Listens on this Mac, on a port the system picks, for as long as the app runs, asking the server through `http`,
    // with no time limit, as a film's stream lasts as long as it plays (but the client's own to connect).
    pub(crate) async fn start(http: Client) -> std::io::Result<Relay> {
        let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
        let at = format!("http://{}", listener.local_addr()?);
        let playing = Playing::default();
        let app = Router::new().route("/{name}", get(pass)).with_state((http, playing.clone()));
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        Ok(Relay { at, playing })
    }

    // The link mpv plays `stream` by, under a name no other program on this Mac can guess; the oldest kept goes.
    pub(crate) fn link(&self, stream: Request) -> String {
        let name = random_id();
        let link = format!("{}/{name}", self.at);
        let mut playing = self.playing.lock().unwrap();
        playing.push((name, stream));
        if playing.len() > KEPT {
            playing.remove(0);
        }
        link
    }
}

// What mpv asks (from where in the file, a seek's `Range`) asked of the server, and its answer passed back: the status,
// what mpv reads of the headers, and the file as it comes.
async fn pass(State((http, playing)): State<(Client, Playing)>, Path(name): Path<String>, headers: HeaderMap) -> Response {
    let stream = playing.lock().unwrap().iter().find(|(n, _)| *n == name).and_then(|(_, r)| r.try_clone());
    let Some(mut stream) = stream else { return StatusCode::NOT_FOUND.into_response() };
    if let Some(range) = headers.get(RANGE) {
        stream.headers_mut().insert(RANGE, range.clone());
    }
    let Ok(answer) = http.execute(stream).await else { return StatusCode::BAD_GATEWAY.into_response() };
    let mut back = Response::builder().status(answer.status());
    for header in [CONTENT_TYPE, CONTENT_LENGTH, CONTENT_RANGE, ACCEPT_RANGES] {
        if let Some(value) = answer.headers().get(&header) {
            back = back.header(header, value);
        }
    }
    // a redirect's target made whole, as mpv would take a bare path for one on this Mac
    // ponytail: one to the server's own host goes to mpv too, which asks there without the token and is turned down;
    // follow those here, with it, if a server turns up that redirects so
    if let Some(to) = answer.headers().get(LOCATION).and_then(|to| answer.url().join(to.to_str().ok()?).ok()) {
        back = back.header(LOCATION, to.as_str());
    }
    back.body(Body::from_stream(answer.bytes_stream())).unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}
