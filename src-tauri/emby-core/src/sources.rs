//! Where a 作品 can be played on a 服务器: its 片源 there, the versions of each (their 清晰度), and the 音轨 and 字幕
//! of each version.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use url::Url;

use crate::browse::{Ids, Listing, items_of};
use crate::{BROWSE, Emby, Error, Kind};

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
#[derive(Debug, PartialEq, Serialize)]
pub struct Version {
    pub id: String,
    pub name: String,
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
/// title in the file (`chs`, `SDH`, a commentary's), how it's coded, and an 音轨's channels.
#[derive(Debug, PartialEq, Serialize)]
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

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct PlaybackInfo {
    #[serde(default)]
    media_sources: Vec<MediaSource>,
}

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
}

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
        let tmdb = tmdb.to_string();
        let mut sources: Vec<Source> = found
            .items
            .into_iter()
            .filter(|f| f.kind == kind.item_type() && f.provider_ids.tmdb.as_ref() == Some(&tmdb))
            .map(|f| Source {
                seasons: series.then(|| f.child_count.unwrap_or(0)),
                versions: f.media_sources.into_iter().map(version).collect(),
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
                    versions: e.media_sources.into_iter().map(version).collect(),
                    item: e.id,
                })
            })
            .collect())
    }

    /// The versions of a movie's 片源 or of an episode, with their 音轨 and 字幕, having the server read a file it
    /// hasn't yet (a .strm), which it then keeps, so `sources` and `episodes` bring them too from then on. Asked as for
    /// playback, as otherwise the server answers from what it has; but nothing plays, and nothing is recorded as
    /// watched.
    pub async fn versions(&self, server: &str, user: &str, item: &str) -> Result<Vec<Version>, Error> {
        let s = self.signed(server, user)?;
        if !plain(item) {
            return Ok(vec![]);
        }
        let query =
            [("UserId", s.server.user_id.as_str()), ("IsPlayback", "true"), ("AutoOpenLiveStream", "false")];
        let info: PlaybackInfo = self.post(&s, &format!("Items/{item}/PlaybackInfo"), &query, READ).await?;
        Ok(info.media_sources.into_iter().map(version).collect())
    }
}

// Whether an id the pages hand over is one Emby gives (digits, or a GUID's hex), safe to put in a path.
fn plain(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric())
}

// A version as Emby lists it: its first picture, its 音轨 and 字幕; none of them while the server hasn't read it.
fn version(m: MediaSource) -> Version {
    let (mut video, mut audio, mut subtitles) = (None, vec![], vec![]);
    for s in m.media_streams {
        match s.kind.as_str() {
            "Video" if video.is_none() => {
                video = Some(Video { width: s.width.unwrap_or(0), height: s.height.unwrap_or(0), range: s.video_range })
            }
            "Audio" => audio.push(track(s)),
            "Subtitle" => subtitles.push(track(s)),
            _ => {}
        }
    }
    Version {
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


fn track(s: Stream) -> Track {
    Track {
        index: s.index,
        language: s.language,
        title: s.title,
        codec: s.codec,
        channels: s.channels,
        default: s.is_default,
        forced: s.is_forced,
    }
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
}
