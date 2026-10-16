//! Where a 作品 can be played on a 服务器: its 片源 there, the versions of each (their 清晰度), and the 音轨 and 字幕
//! of each version; and what a version plays, its own link or the server's stream of it, and where the user left off.

use std::net::IpAddr;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use url::{Host, Url};

use crate::browse::{Ids, Listing, items_of};
use crate::find::unsent;
use crate::relay::Relay;
use crate::{BROWSE, Emby, Error, Kind, Signed};

// how long resolving a server's name may take, for how far it is (`reach_of`): it just answered, so it's known
const RESOLVE: Duration = Duration::from_secs(2);

// How long a server may take to read a file it hasn't yet: a .strm's start comes from the cloud, about 5 s the first
// time on the user's server.
const READ: Duration = Duration::from_secs(30);

/// A 片源: a 作品 as a server keeps it, which one server may do twice (in two 媒体库). A movie's comes with its
/// versions; a series' with how many seasons it has there, its episodes asked a season at a time (`episodes`).
#[derive(Debug, PartialEq, Serialize)]
pub struct Source {
    pub item: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seasons: Option<u32>,
    pub versions: Vec<Version>,
}

/// An episode on a series' 片源, numbered as the server numbers it; `last` for a file holding several (S01E01-E02).
#[derive(Debug, PartialEq, Serialize)]
pub struct Episode {
    pub item: String,
    pub season: u32,
    pub episode: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last: Option<u32>,
    pub versions: Vec<Version>,
}

/// A version of a 片源, one file: its name (as a release names itself, the 作品's name, 清晰度, source and group),
/// its picture, bitrate, and its 音轨 and 字幕, once the server has read it. One it hasn't read yet (a .strm) has
/// neither picture nor bitrate nor tracks, till `versions` has it read; its `name` and `file` often say its 清晰度 anyway.
/// `plays` when the app can play it (`play`), from its link or through the server.
#[derive(Debug, PartialEq, Serialize)]
pub struct Version {
    pub id: String,
    pub name: String,
    pub plays: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// bits a second
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bitrate: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video: Option<Video>,
    pub audio: Vec<Track>,
    pub subtitles: Vec<Track>,
}

/// A version's picture: its size, and its range (`HDR 10`, `SDR`).
#[derive(Debug, PartialEq, Serialize)]
pub struct Video {
    pub width: u32,
    pub height: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<String>,
}

/// An 音轨 or a 字幕, by its index in the file: its language as Emby has it (ISO 639-2, often the older `chi`), its
/// title in the file (`chs`, `SDH`, a commentary's), how it's coded, and an 音轨's channels; `external` for a 字幕 in
/// a file of its own beside the video's, numbered after the file's own.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Track {
    pub index: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codec: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channels: Option<u32>,
    pub default: bool,
    pub forced: bool,
    pub external: bool,
}

/// A 字幕 in a file beside the video's, and the link the player reads it by, from the server.
#[derive(Clone, Debug, PartialEq)]
pub struct Beside {
    pub track: Track,
    pub link: String,
}

// The parts of Emby's answers read here. A list leaves some out unless its `Fields` asks for them: those `Found` reads
// of a series' 片源, or of a movie's.
const SERIES: &str = "ProviderIds,ChildCount";
const MOVIE: &str = "ProviderIds,MediaSources";
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Found {
    id: String,
    name: String,
    #[serde(rename = "Type")]
    kind: String,
    #[serde(default)]
    provider_ids: Ids,
    child_count: Option<u32>,
    #[serde(default)]
    media_sources: Vec<MediaSource>,
}

// what `Aired` reads that a list leaves out unless its `Fields` asks for it
const AIRED: &str = "MediaSources";
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Aired {
    id: String,
    parent_index_number: Option<u32>,
    index_number: Option<u32>,
    index_number_end: Option<u32>,
    #[serde(default)]
    media_sources: Vec<MediaSource>,
}

// What a read as for playback answers (`read`): the versions read, and the play session it opened, which reports on
// playing name (`watch`).
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(crate) struct PlaybackInfo {
    #[serde(default)]
    media_sources: Vec<MediaSource>,
    pub(crate) play_session_id: Option<String>,
}

// A version as Emby has it; with how Emby says it can be played (`link_of`).
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct MediaSource {
    id: String,
    #[serde(default)]
    name: String,
    path: Option<String>,
    bitrate: Option<u64>,
    #[serde(default)]
    media_streams: Vec<Stream>,
    // Http for a link (a .strm's), File for one on the server's disk
    protocol: Option<String>,
    #[serde(default)]
    is_remote: bool,
    #[serde(default)]
    supports_direct_play: bool,
    // whether the server can send the file as it is, unconverted (Emby's static stream)
    #[serde(default)]
    supports_direct_stream: bool,
    required_http_headers: Option<Map<String, Value>>,
}

/// What a version plays: its own link, played from where it is, or one on this Mac for the server's stream of it
/// (`Relay`), and where the user left off (seconds in, 0 for the start); and the 字幕 beside its file.
#[derive(Debug, PartialEq)]
pub struct Play {
    pub url: String,
    pub start: f64,
    pub beside: Vec<Beside>,
}

// The parts of a 作品's own answer `play` reads: its versions, and the user's place in it.
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Playing {
    #[serde(default)]
    media_sources: Vec<MediaSource>,
    user_data: Option<UserData>,
}

// The user's place in a 作品: where they left off, in Emby's ticks (TICKS a second), and when they last played it, which
// a list leaves out unless asked for (`resume`).
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(crate) struct UserData {
    #[serde(default)]
    pub(crate) playback_position_ticks: u64,
    pub(crate) last_played_date: Option<String>,
}
pub(crate) const TICKS: f64 = 1e7;

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Stream {
    #[serde(rename = "Type")]
    kind: String,
    index: u32,
    codec: Option<String>,
    language: Option<String>,
    title: Option<String>,
    channels: Option<u32>,
    width: Option<u32>,
    height: Option<u32>,
    video_range: Option<String>,
    #[serde(default)]
    is_default: bool,
    #[serde(default)]
    is_forced: bool,
    #[serde(default)]
    is_external: bool,
    // a 字幕 of text (SRT, ASS), not pictures, which the server sends as a file of its own only so
    #[serde(default)]
    is_text_subtitle_stream: bool,
}

impl Emby {
    /// The 片源 of a 作品 on a server, found by its kind and TMDB entry: none when the server doesn't have it. A series
    /// kept twice, with its episodes in one copy only, has that one first.
    pub async fn sources(&self, server: &str, user: &str, kind: Kind, tmdb: u64) -> Result<Vec<Source>, Error> {
        let s = self.signed(server, user)?;
        let series = kind.episodic();
        let id = format!("Tmdb.{tmdb}");
        // A few at most, and only those that are this TMDB entry of this kind: a server that doesn't know
        // AnyProviderIdEquals (Jellyfin answers under /emby too) would otherwise send its whole library, and one that
        // doesn't know IncludeItemTypes a movie with a series' number, as TMDB numbers each kind apart.
        let query = [
            ("AnyProviderIdEquals", id.as_str()),
            ("Recursive", "true"),
            ("IncludeItemTypes", kind.item_type()),
            ("Fields", if series { SERIES } else { MOVIE }),
            ("Limit", "20"),
            // no pictures, but its user data, unlike `episodes`: without it Emby counts a series' seasons as 0 (as the
            // user's 4.9.5 does)
            ("EnableImages", "false"),
        ];
        let found: Listing<Found> = self.get(&s, &items_of(&s), &query, BROWSE).await?;
        let server = reach_for(&s.server.address, found.items.iter().flat_map(|f| &f.media_sources)).await;
        let tmdb = tmdb.to_string();
        let mut sources: Vec<Source> = found
            .items
            .into_iter()
            .filter(|f| f.kind == kind.item_type() && f.provider_ids.tmdb.as_ref() == Some(&tmdb))
            .map(|f| Source {
                seasons: series.then(|| f.child_count.unwrap_or(0)),
                versions: f.media_sources.into_iter().map(|m| version(m, server)).collect(),
                item: f.id,
                name: f.name,
            })
            .collect();
        sources.sort_by_key(|s| std::cmp::Reverse(s.seasons));
        Ok(sources)
    }

    /// The episodes of a season on a series' 片源, numbered as the server numbers them, with their versions. A series
    /// numbered otherwise there than on TMDB (one long season of an anime) has other episodes under the same numbers.
    // ponytail: a whole season in one answer, versions and tracks too; a season of hundreds (the user's server has a 国漫
    // past 380) is mostly .strm with no tracks, so small. Page it by StartIndex if one runs past BROWSE.
    pub async fn episodes(&self, server: &str, user: &str, series: &str, season: u32) -> Result<Vec<Episode>, Error> {
        let s = self.signed(server, user)?;
        if !plain(series) {
            return Ok(vec![]);
        }
        let season = season.to_string();
        let query = [
            ("UserId", s.server.user_id.as_str()),
            ("Season", &season),
            // not those a server set to show missing episodes lists with no file
            ("IsMissing", "false"),
            ("Fields", AIRED),
            ("EnableImages", "false"),
            ("EnableUserData", "false"),
        ];
        let aired: Listing<Aired> = self.get(&s, &format!("Shows/{series}/Episodes"), &query, BROWSE).await?;
        let server = reach_for(&s.server.address, aired.items.iter().flat_map(|e| &e.media_sources)).await;
        Ok(aired
            .items
            .into_iter()
            // one with no file is a placeholder, not yet aired or missing, and so not on the 片源
            .filter(|e| !e.media_sources.is_empty())
            .filter_map(|e| {
                Some(Episode {
                    season: e.parent_index_number?,
                    episode: e.index_number?,
                    last: e.index_number_end,
                    versions: e.media_sources.into_iter().map(|m| version(m, server)).collect(),
                    item: e.id,
                })
            })
            .collect())
    }

    /// The versions of a movie's 片源 or of an episode, with their 音轨 and 字幕, having the server read a file it
    /// hasn't yet (a .strm), which it then keeps, so `sources` and `episodes` bring them too from then on (`read`).
    pub async fn versions(&self, server: &str, user: &str, item: &str) -> Result<Vec<Version>, Error> {
        let s = self.signed(server, user)?;
        if !plain(item) {
            return Ok(vec![]);
        }
        let info = self.read(&s, item, None).await?;
        let server = reach_for(&s.server.address, &info.media_sources).await;
        Ok(info.media_sources.into_iter().map(|m| version(m, server)).collect())
    }

    /// What a version of a 作品 (a movie, or an episode) plays, and where the user left off: its own link where it
    /// plays from where it is (`link_of`), else the server's stream of its file through a link on this Mac (`Relay`),
    /// as the player is never given the token. `Unplayable` for one that plays only converted.
    pub async fn play(&self, server: &str, user: &str, item: &str, version: &str) -> Result<Play, Error> {
        let s = self.signed(server, user)?;
        // as for one the server doesn't have, never put in a path
        let gone = Error::Server { status: 404 };
        if !plain(item) {
            return Err(gone);
        }
        let playing: Playing = self.get(&s, &format!("{}/{item}", items_of(&s)), &[], BROWSE).await?;
        let m = playing.media_sources.into_iter().find(|m| m.id == version).ok_or(gone)?;
        // from its link where it plays so (the user's call: faster, and none of the server's bandwidth), else through
        // the server, which sends the file as it is
        let url = match link_of(&m, reach_for(&s.server.address, [&m]).await) {
            Some(link) => link,
            None if m.supports_direct_stream => {
                let stream = self.ask(self.http.get(format!("{}/Videos/{item}/stream", s.server.address)), &s.token);
                let stream = stream.query(&[("static", "true"), ("MediaSourceId", version)]).build().map_err(unsent)?;
                // nothing to listen on (out of ports or files), which no version gets past
                let relay = self.relay.get_or_try_init(|| Relay::start(self.http.clone())).await;
                relay.map_err(|_| Error::Unplayable)?.link(stream)
            }
            None => return Err(Error::Unplayable),
        };
        let beside = m.media_streams.into_iter().filter_map(|t| beside(&s.server.address, item, version, t)).collect();
        let ticks = playing.user_data.map_or(0, |u| u.playback_position_ticks);
        Ok(Play { url, start: ticks as f64 / TICKS, beside })
    }

    // Has the server read a 作品's file (the version named, or each) as for playback, as otherwise it answers from what
    // it has; nothing plays, and nothing is recorded as watched. `item` is one `plain` passed.
    pub(crate) async fn read(&self, s: &Signed, item: &str, version: Option<&str>) -> Result<PlaybackInfo, Error> {
        let mut query = vec![("UserId", s.server.user_id.as_str()), ("IsPlayback", "true"), ("AutoOpenLiveStream", "false")];
        query.extend(version.map(|v| ("MediaSourceId", v)));
        self.post(s, &format!("Items/{item}/PlaybackInfo"), &query, READ).await
    }
}

// Whether an id the pages hand over is one Emby gives (digits, or a GUID's hex), safe to put in a path.
pub(crate) fn plain(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric())
}

// A version as Emby lists it, on a `server` that far away: its first picture, its 音轨 and 字幕, none of them while
// the server hasn't read it; and whether the app can play it.
fn version(m: MediaSource, server: Reach) -> Version {
    // from its link, or through the server as it is
    let plays = m.supports_direct_stream || link_of(&m, server).is_some();
    let (mut video, mut audio, mut subtitles) = (None, vec![], vec![]);
    for s in m.media_streams {
        match s.kind.as_str() {
            "Video" if video.is_none() => {
                video = Some(Video { width: s.width.unwrap_or(0), height: s.height.unwrap_or(0), range: s.video_range })
            }
            // an 音轨 in a file beside the video's, which mpv isn't given (rare: none on the user's servers), nor a 字幕
            // of pictures there: none to pick
            "Audio" if !s.is_external => audio.push(track(s)),
            "Subtitle" if !s.is_external || readable(&s) => subtitles.push(track(s)),
            _ => {}
        }
    }
    Version {
        plays,
        id: m.id,
        name: m.name,
        file: m.path.as_deref().and_then(file_name),
        bitrate: m.bitrate.filter(|&n| n > 0),
        video,
        audio,
        subtitles,
    }
}

// The last part of a file's path, on the server's disk (either slash, and ? and # are a name's own there) or in a
// .strm's link, which keeps it URI-encoded; of a link, only its path: never its host, nor its query, which may carry
// the cloud drive's signature.
fn file_name(path: &str) -> Option<String> {
    let name = if path.contains("://") {
        Url::parse(path).ok()?.path_segments()?.next_back()?.to_owned()
    } else {
        path.rsplit(['/', '\\']).next()?.to_owned()
    };
    Some(name).filter(|name| !name.is_empty())
}

// The link a version plays by, from where it is, when Emby would play it so (as its web app plays a .strm's): a remote
// http(s) link the server says plays directly and asks no headers for, as nothing but the link goes to the player, the
// token least of all. One on this Mac or a local network only when the `server` is there too: the server's 127.0.0.1
// is another machine than this one, and its network may not be this one's. Any other plays through the server.
// ponytail: tells a link's host by its IP (and localhost), so a link to nas.local from a server out on the internet
// still goes to the player, which then fails to open it. Resolve its name too (as `reach_of` does the server's) if one
// ever turns up.
fn link_of(m: &MediaSource, server: Reach) -> Option<String> {
    let mut link = Url::parse(m.path.as_deref()?).ok()?;
    let plays = m.supports_direct_play
        && m.is_remote
        && m.protocol.as_deref() == Some("Http")
        && m.required_http_headers.as_ref().is_none_or(Map::is_empty)
        && matches!(link.scheme(), "http" | "https");
    // as the url crate writes it, percent-encoded, which the player sends as it is; and without a fragment, which a
    // browser wouldn't send either
    link.set_fragment(None);
    (plays && reach(&link) >= server).then(|| link.into())
}

// How far a host is from this Mac: the Mac itself, a local network (as reached from it), or anywhere.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Reach {
    Here,
    Near,
    Anywhere,
}

// How far the host of `url` is, as its IP says, or `localhost`: any other name may be anywhere.
fn reach(url: &Url) -> Reach {
    match url.host() {
        Some(Host::Domain("localhost")) => Reach::Here,
        Some(Host::Ipv4(ip)) => reach_ip(ip.into()),
        Some(Host::Ipv6(ip)) => reach_ip(ip.into()),
        _ => Reach::Anywhere,
    }
}

// How far the server at `address` is, which only a version's link on this Mac or a local network asks (`link_of`), so
// it's looked up only for those: anywhere otherwise.
async fn reach_for<'a>(address: &str, versions: impl IntoIterator<Item = &'a MediaSource>) -> Reach {
    let local = |m: &MediaSource| m.path.as_deref().and_then(|p| Url::parse(p).ok()).is_some_and(|l| reach(&l) < Reach::Anywhere);
    if versions.into_iter().any(local) { reach_of(address).await } else { Reach::Anywhere }
}

// How far the server at `address` is, its name resolved to its IPs, the nearest of them counting: a NAS added by its
// name (nas.local, or nas) is on this network. Anywhere when it doesn't resolve within RESOLVE.
async fn reach_of(address: &str) -> Reach {
    let Ok(url) = Url::parse(address) else { return Reach::Anywhere };
    match (url.host(), url.port_or_known_default()) {
        (Some(Host::Domain(name)), Some(port)) if name != "localhost" => {
            match tokio::time::timeout(RESOLVE, tokio::net::lookup_host((name, port))).await {
                Ok(Ok(found)) => found.map(|at| reach_ip(at.ip())).min().unwrap_or(Reach::Anywhere),
                _ => Reach::Anywhere,
            }
        }
        _ => reach(&url),
    }
}

fn reach_ip(ip: IpAddr) -> Reach {
    // an IPv4 address written as IPv6 (::ffff:127.0.0.1) is the IPv4 one
    match ip.to_canonical() {
        IpAddr::V4(ip) if ip.is_loopback() || ip.is_unspecified() => Reach::Here,
        IpAddr::V4(ip) if ip.is_private() || ip.is_link_local() => Reach::Near,
        IpAddr::V6(ip) if ip.is_loopback() || ip.is_unspecified() => Reach::Here,
        IpAddr::V6(ip) if ip.is_unique_local() || ip.is_unicast_link_local() => Reach::Near,
        _ => Reach::Anywhere,
    }
}

fn track(s: Stream) -> Track {
    Track {
        index: s.index,
        language: s.language,
        title: s.title,
        codec: s.codec,
        channels: s.channels,
        default: s.is_default,
        forced: s.is_forced,
        external: s.is_external,
    }
}

// A 字幕 of text in a file beside that of a version (`id`) of `item`, with its link: Emby's, in the file's own format
// (an external one's codec is its file's: ass, srt), which needs no token, as Emby's own apps read them so (checked on
// both of the user's servers), so the player is given it.
// ponytail: a server that asks for a token there leaves the 字幕 unread and the film playing without; read them through
// `Relay` if one turns up.
fn beside(address: &str, item: &str, id: &str, s: Stream) -> Option<Beside> {
    if !(s.kind == "Subtitle" && s.is_external && readable(&s)) {
        return None;
    }
    let (index, file) = (s.index.to_string(), format!("Stream.{}", s.codec.as_deref()?));
    let mut link = Url::parse(address).ok()?;
    link.path_segments_mut().ok()?.pop_if_empty().extend(["Videos", item, id, "Subtitles", &index, &file]);
    Some(Beside { link: link.into(), track: track(s) })
}

// Whether a 字幕 beside the file can be given to the player, and so is offered: one of text, which the server sends as a
// file of its own, in a format a path can name.
fn readable(s: &Stream) -> bool {
    s.is_text_subtitle_stream && s.codec.as_deref().is_some_and(plain)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_files_name_is_its_paths_last_part_and_a_links_only_from_its_path() {
        assert_eq!(file_name("/mnt/movies/Movie #9 (2015)/Movie #9 - 1080p.mkv").as_deref(), Some("Movie #9 - 1080p.mkv"));
        assert_eq!(file_name("D:\\Movies\\X.2019.1080p.mkv").as_deref(), Some("X.2019.1080p.mkv"));
        assert_eq!(file_name("https://drive/d/a/X.2160p.mkv?sign=s#t=0").as_deref(), Some("X.2160p.mkv"));
        // a link with no path, or none before its query, names no file
        assert_eq!(file_name("http://192.168.1.5:5244"), None);
        assert_eq!(file_name("http://192.168.1.5:5244?path=/X.2160p.mkv"), None);
        assert_eq!(file_name("https://drive/d/"), None);
    }

    // A version as Emby lists a .strm's, its link at `path`: all it takes to play from there.
    fn remote(path: &str) -> Value {
        serde_json::json!({ "Id": "v", "Path": path, "Protocol": "Http", "IsRemote": true, "SupportsDirectPlay": true,
            "RequiredHttpHeaders": {} })
    }

    fn link(m: Value, address: &str) -> Option<String> {
        link_of(&serde_json::from_value(m).unwrap(), reach(&Url::parse(address).unwrap()))
    }

    #[test]
    fn a_version_plays_from_its_link_when_emby_would_and_this_mac_can_reach_it() {
        let out = "https://emby.example/emby";
        assert_eq!(link(remote("https://drive/d/X.mkv"), out).as_deref(), Some("https://drive/d/X.mkv"));
        // over http too, encoded as it goes out, without a fragment
        assert_eq!(link(remote("http://drive/d/春江.mkv#t=0"), out).as_deref(), Some("http://drive/d/%E6%98%A5%E6%B1%9F.mkv"));
        let mut no_headers = remote("https://drive/d/X.mkv");
        no_headers["RequiredHttpHeaders"] = Value::Null;
        assert!(link(no_headers, out).is_some());
        // not one Emby would play so: a file on the server's disk, a link it reads itself, or one needing headers
        for (field, value) in [
            ("Protocol", serde_json::json!("File")),
            ("IsRemote", serde_json::json!(false)),
            ("SupportsDirectPlay", serde_json::json!(false)),
            ("RequiredHttpHeaders", serde_json::json!({ "Cookie": "c" })),
        ] {
            let mut m = remote("https://drive/d/X.mkv");
            m[field] = value;
            assert_eq!(link(m, out), None, "{field}");
        }
        assert_eq!(link(remote("rtsp://drive/X.mkv"), out), None);
        assert_eq!(link(remote("/mnt/movies/X.mkv"), out), None);
        // none on the server's own machine or network, from a server out on the internet
        for near in ["http://127.0.0.1:5244/X.mkv", "http://localhost/X.mkv", "http://0.0.0.0/X.mkv", "http://192.168.1.5/X.mkv",
            "http://169.254.0.5/X.mkv", "http://[::1]/X.mkv", "http://[fd00::5]/X.mkv", "http://[::ffff:127.0.0.1]/X.mkv"]
        {
            assert_eq!(link(remote(near), out), None, "{near}");
        }
        // but one on this network from a server on it, or on this Mac; and one on this Mac from a server on it
        let lan = "http://192.168.1.5:5244/X.mkv";
        assert!(link(remote(lan), "http://192.168.1.2:8096/emby").is_some());
        assert!(link(remote(lan), "http://127.0.0.1:8096/emby").is_some());
        assert!(link(remote("http://127.0.0.1:5244/X.mkv"), "http://192.168.1.2:8096/emby").is_none());
        assert!(link(remote("http://127.0.0.1:5244/X.mkv"), "http://localhost:8096/emby").is_some());
    }

    #[tokio::test]
    async fn a_server_named_by_its_ip_or_localhost_is_as_far_as_that_says() {
        assert!(reach_of("http://localhost:8096/emby").await == Reach::Here);
        assert!(reach_of("http://192.168.1.2:8096/emby").await == Reach::Near);
        assert!(reach_of("http://[::ffff:10.0.0.2]:8096/emby").await == Reach::Near);
        assert!(reach_of("https://203.0.113.9/emby").await == Reach::Anywhere);
    }
}
