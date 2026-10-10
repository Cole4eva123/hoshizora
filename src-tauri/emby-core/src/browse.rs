//! A 服务器's 媒体库 and their 作品, tidied into what the pages draw.

use serde::{Deserialize, Serialize};

use crate::{BROWSE, Emby, Error};

/// A 媒体库 of movies or series, with the 16:9 cover the server draws for it.
#[derive(Debug, PartialEq, Serialize)]
pub struct Library {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
}

/// A 作品 as a server keeps it: its name and 海报 there, and the TMDB entry it is, when the server knows it.
#[derive(Debug, PartialEq, Serialize)]
pub struct Item {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub poster: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tmdb: Option<Tmdb>,
}

/// A TMDB entry, named as the 作品 pages' routes name it.
#[derive(Debug, PartialEq, Serialize)]
pub struct Tmdb {
    pub media_type: &'static str,
    pub id: u64,
}

/// How a 媒体库's 作品 are put in order: the newest added first; by premiere, the newest or the oldest first; or by
/// Emby's community rating, which counts no votes, so a title one person gave 10 can lead.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Sort {
    Added,
    Latest,
    Oldest,
    Rating,
}

/// A page of a 媒体库's 作品; the page from the 0th has the count of them all.
#[derive(Debug, PartialEq, Serialize)]
pub struct Page {
    pub items: Vec<Item>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u32>,
}

// The parts of Emby's lists read here.
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Listing<T> {
    items: Vec<T>,
    #[serde(default)]
    total_record_count: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct View {
    id: String,
    name: String,
    collection_type: Option<String>,
    #[serde(default)]
    image_tags: Tags,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Listed {
    id: String,
    name: String,
    #[serde(rename = "Type")]
    kind: String,
    production_year: Option<u32>,
    #[serde(default)]
    image_tags: Tags,
    #[serde(default)]
    provider_ids: Ids,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Tags {
    primary: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Ids {
    tmdb: Option<String>,
}

impl Emby {
    /// The 媒体库 a server shows its user, in the order set on the server: only those of movies, series or both, as
    /// music, photos and the like can't be played here.
    pub async fn libraries(&self, server: &str, user: &str) -> Result<Vec<Library>, Error> {
        let s = self.signed(server, user)?;
        let views: Listing<View> = self.get(&s, &format!("Users/{}/Views", s.server.user_id), &[], BROWSE).await?;
        Ok(views
            .items
            .into_iter()
            .filter(|v| v.collection_type.as_deref().is_none_or(|t| ["movies", "tvshows", "mixed"].contains(&t)))
            .map(|v| Library { cover: image(&s.server.address, &v.id, v.image_tags.primary, 480), id: v.id, name: v.name })
            .collect())
    }

    /// A page of a 媒体库's movies and series in the order `sort` asks for, `limit` of them from the `start`th. Only the
    /// page from the 0th has the count of them all, as counting a large 媒体库 is work for the server.
    pub async fn items(
        &self,
        server: &str,
        user: &str,
        library: &str,
        sort: Sort,
        start: u32,
        limit: u32,
    ) -> Result<Page, Error> {
        let s = self.signed(server, user)?;
        let (from, count) = (start.to_string(), limit.to_string());
        // an order for each field: the sort's, then A to Z, for a batch added at once (a library scan) or a tie
        let (by, order) = match sort {
            Sort::Added => ("DateCreated,SortName", "Descending,Ascending"),
            Sort::Latest => ("PremiereDate,SortName", "Descending,Ascending"),
            Sort::Oldest => ("PremiereDate,SortName", "Ascending,Ascending"),
            Sort::Rating => ("CommunityRating,SortName", "Descending,Ascending"),
        };
        let mut query = vec![
            ("ParentId", library),
            ("Recursive", "true"),
            ("IncludeItemTypes", "Movie,Series"),
            ("SortBy", by),
            ("SortOrder", order),
            ("Fields", "ProviderIds,ProductionYear"),
            ("EnableImageTypes", "Primary"),
            ("ImageTypeLimit", "1"),
            ("EnableUserData", "false"),
            ("StartIndex", &from),
            ("Limit", &count),
            ("EnableTotalRecordCount", if start == 0 { "true" } else { "false" }),
        ];
        // By premiere, only those premiered: none still to come, none with no date, and none with the date Emby writes
        // for one it doesn't know (0001-01-01), which would lead the oldest.
        // ponytail: IsUnaired leaves out movies and series still to come on Emby 4.9 (checked on the user's 4.9.5); an
        // older Emby may apply it to episodes only. Send MaxPremiereDate with today's date if one turns up.
        if matches!(sort, Sort::Latest | Sort::Oldest) {
            query.extend([("IsUnaired", "false"), ("MinPremiereDate", "1800-01-01T00:00:00Z")]);
        }
        let listing: Listing<Listed> = self.get(&s, &format!("Users/{}/Items", s.server.user_id), &query, BROWSE).await?;
        Ok(Page {
            items: listing.items.into_iter().map(|i| item(&s.server.address, i)).collect(),
            total: (start == 0).then_some(listing.total_record_count),
        })
    }
}

// A server's picture, sized down to `width`; `tag` changes when one is replaced, so a new one isn't served from the
// cache. Pictures need no token, so the pages load them from the server directly.
// ponytail: an http server's pictures may be blocked in the bundled app (its page is tauri://, and macOS's ATS); hand
// them over through a URI scheme of the app's own if that turns up.
fn image(address: &str, id: &str, tag: Option<String>, width: u32) -> Option<String> {
    tag.map(|tag| format!("{address}/Items/{id}/Images/Primary?tag={tag}&maxWidth={width}&quality=90"))
}

// A 作品 as listed, linked to its TMDB entry when the server knows it.
fn item(address: &str, i: Listed) -> Item {
    let tmdb = i.provider_ids.tmdb.and_then(|id| id.parse::<u64>().ok()).filter(|&id| id > 0);
    Item {
        poster: image(address, &i.id, i.image_tags.primary, 342),
        tmdb: tmdb.map(|id| Tmdb { media_type: if i.kind == "Series" { "tv" } else { "movie" }, id }),
        year: i.production_year,
        id: i.id,
        name: i.name,
    }
}
