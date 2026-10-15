//! The user's place in what they play on a 服务器: the 继续观看 it keeps for them, and telling it as they play, so that
//! list, and where a 作品 picks up (`play`), follow what was watched here.

use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::browse::{BACKDROP, Ids, Listing, PRIMARY, THUMB, Tags, Tmdb, image, items_of, tmdb_of};
use crate::sources::{TICKS, UserData, plain};
use crate::{BROWSE, Emby, Error, Kind};

// how wide a 继续观看's 剧照 is asked for: a row's card, three to five to a screen, on a sharp screen
const STILL: u32 = 640;
// how many a server is asked for, more than a row shows at once
const RESUME: &str = "24";
// a report, sent as it plays and waited on by nobody: one the server is slow to take is dropped, as the next tells
// where it is anyway
const REPORT: Duration = Duration::from_secs(10);

/// A movie or an episode the user started and hasn't finished on a server: its name, and for an episode its series' (and
/// the series' item there, its 片源) and numbers; the TMDB entry of the movie or the series, for its page; a 16:9 剧照 (the episode's own, else the
/// 作品's thumb or backdrop); where they left off and how long it is (seconds; the length
/// unknown for a .strm the server hasn't read), and when they last played it (Emby's ISO 8601, in UTC).
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resume {
    pub item: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub series: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub series_item: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub season: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub episode: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tmdb: Option<Tmdb>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub still: Option<String>,
    pub position: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub played: Option<String>,
}

/// A version being played, as the reports on it name it: opened by `watch`, then told of by `progress` and `stopped`; and
/// whether it was paused when last told.
pub struct Watch {
    server: String,
    user: String,
    item: String,
    version: String,
    session: String,
    paused: bool,
}

// What `Started` reads that Emby leaves out of a list unless its `Fields` asks for it, when it was last played too (4.9
// leaves that out of a list's user data)
const STARTED: &str = "ProviderIds,ProductionYear,UserDataLastPlayedDate";
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Started {
    id: String,
    name: String,
    #[serde(rename = "Type")]
    kind: String,
    production_year: Option<u32>,
    run_time_ticks: Option<u64>,
    #[serde(default)]
    image_tags: Tags,
    #[serde(default)]
    backdrop_image_tags: Vec<String>,
    #[serde(default)]
    provider_ids: Ids,
    user_data: Option<UserData>,
    // an episode's series, and the series' pictures it shows when it has none of its own
    series_id: Option<String>,
    series_name: Option<String>,
    parent_index_number: Option<u32>,
    index_number: Option<u32>,
    parent_thumb_item_id: Option<String>,
    parent_thumb_image_tag: Option<String>,
    parent_backdrop_item_id: Option<String>,
    #[serde(default)]
    parent_backdrop_image_tags: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Series {
    id: String,
    #[serde(default)]
    provider_ids: Ids,
}

impl Emby {
    /// The 继续观看 a server keeps for its user, the last played first: movies and episodes started and not finished,
    /// as Emby counts them (past its least, and short of its most, of the length: 5% and 90% unless set otherwise).
    pub async fn resume(&self, server: &str, user: &str) -> Result<Vec<Resume>, Error> {
        let s = self.signed(server, user)?;
        let types = Kind::ALL.map(Kind::plays).join(",");
        let query = [
            ("MediaTypes", "Video"),
            ("IncludeItemTypes", types.as_str()),
            ("Fields", STARTED),
            ("EnableImageTypes", "Primary,Backdrop,Thumb"),
            ("ImageTypeLimit", "1"),
            ("Limit", RESUME),
        ];
        let started: Listing<Started> = self.get(&s, &format!("{}/Resume", items_of(&s)), &query, BROWSE).await?;
        // an episode carries no TMDB entry of its series (nor, mostly, of its own): its series are asked for theirs
        let series: Vec<&str> = started.items.iter().filter_map(|i| i.series_id.as_deref()).filter(|id| plain(id)).collect();
        let tmdb = if series.is_empty() {
            HashMap::new()
        } else {
            let ids = series.join(",");
            let query = [("Ids", ids.as_str()), ("Fields", "ProviderIds"), ("EnableImages", "false"), ("EnableUserData", "false")];
            // one that couldn't be asked leaves its episodes with no page, still played from their cards
            let found: Result<Listing<Series>, _> = self.get(&s, &items_of(&s), &query, BROWSE).await;
            found.map(|f| f.items.into_iter().filter_map(|f| Some((f.id, f.provider_ids.tmdb?))).collect()).unwrap_or_default()
        };
        Ok(started.items.into_iter().filter_map(|i| resume(&s.server.address, i, &tmdb)).collect())
    }

    /// Starts telling the server of a version played from `position` (seconds in): the file read first, as for
    /// playback, since a server that doesn't know how long a 作品 is takes it as watched to the end where it stops
    /// (Emby's rule, as for a .strm it hasn't read); which also opens the play session the reports name.
    pub async fn watch(&self, server: &str, user: &str, item: &str, version: &str, position: f64) -> Result<Watch, Error> {
        let s = self.signed(server, user)?;
        if !plain(item) {
            return Err(Error::Server { status: 404 });
        }
        let session = self.read(&s, item, Some(version)).await?.play_session_id;
        let watch = Watch {
            server: server.into(),
            user: user.into(),
            item: item.into(),
            version: version.into(),
            // ponytail: one of its own where Emby gives none, as its Kodi add-on makes for a version it plays itself;
            // whether a server takes reports under it unasked is unchecked, as every Emby asked gives one
            session: session.unwrap_or_else(crate::kept::random_id),
            paused: false,
        };
        self.tell(&s, "Sessions/Playing", &report(&watch, position), REPORT).await?;
        Ok(watch)
    }

    /// Tells the server where a version being played is, and whether it's paused: a pause or a play as what it is, as
    /// Emby's own apps tell it.
    pub async fn progress(&self, watch: &mut Watch, position: f64, paused: bool) -> Result<(), Error> {
        let s = self.signed(&watch.server, &watch.user)?;
        let event = match (watch.paused, paused) {
            (false, true) => "pause",
            (true, false) => "unpause",
            _ => "timeupdate",
        };
        let mut body = report(watch, position);
        (body["IsPaused"], body["EventName"]) = (json!(paused), json!(event));
        self.tell(&s, "Sessions/Playing/Progress", &body, REPORT).await?;
        watch.paused = paused;
        Ok(())
    }

    /// Tells the server a version has stopped playing, and where: kept as where it picks up, or, near its end, as
    /// watched.
    pub async fn stopped(&self, watch: &Watch, position: f64) -> Result<(), Error> {
        let s = self.signed(&watch.server, &watch.user)?;
        self.tell(&s, "Sessions/Playing/Stopped", &report(watch, position), REPORT).await
    }
}

// A report on a version played (Emby's PlaybackProgressInfo), from where it is.
fn report(watch: &Watch, position: f64) -> Value {
    json!({
        "ItemId": watch.item,
        "MediaSourceId": watch.version,
        "PlaySessionId": watch.session,
        "PositionTicks": (position.max(0.0) * TICKS) as u64,
        "PlayMethod": "DirectPlay",
        "CanSeek": true,
    })
}

// A 继续观看 as the pages draw it, linked to the TMDB entry of its movie or series; one of a kind there's no page for
// (a music video) is left out.
fn resume(address: &str, i: Started, series: &HashMap<String, String>) -> Option<Resume> {
    let kind = Kind::ALL.into_iter().find(|k| k.plays() == i.kind)?;
    let tmdb = if kind.episodic() { i.series_id.as_ref().and_then(|id| series.get(id)) } else { i.provider_ids.tmdb.as_ref() };
    let tmdb = tmdb_of(kind, tmdb.map(String::as_str));
    let at = |id: Option<&str>, picture, tag: Option<String>| id.and_then(|id| image(address, id, picture, tag, STILL));
    let own = Some(i.id.as_str());
    let still = if kind.episodic() { at(own, PRIMARY, i.image_tags.primary) } else { None }
        .or_else(|| at(own, THUMB, i.image_tags.thumb))
        .or_else(|| at(i.parent_thumb_item_id.as_deref(), THUMB, i.parent_thumb_image_tag))
        .or_else(|| at(own, BACKDROP, i.backdrop_image_tags.into_iter().next()))
        .or_else(|| at(i.parent_backdrop_item_id.as_deref(), BACKDROP, i.parent_backdrop_image_tags.into_iter().next()));
    let user = i.user_data;
    Some(Resume {
        position: user.as_ref().map_or(0, |u| u.playback_position_ticks) as f64 / TICKS,
        played: user.and_then(|u| u.last_played_date),
        runtime: i.run_time_ticks.filter(|&t| t > 0).map(|t| t as f64 / TICKS),
        series: i.series_name.filter(|_| kind.episodic()),
        series_item: i.series_id.filter(|_| kind.episodic()),
        season: i.parent_index_number.filter(|_| kind.episodic()),
        episode: i.index_number.filter(|_| kind.episodic()),
        year: i.production_year,
        item: i.id,
        name: i.name,
        tmdb,
        still,
    })
}
