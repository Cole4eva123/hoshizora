//! How the picture's colours reach the screen, as IINA's VideoView does (refreshEdrMode, setICCProfile): an HDR film on
//! a screen that can go past white (EDR, an XDR display) is drawn in PQ, which macOS shows bright; anything else mpv
//! maps to the screen's own colour profile, which the layer then shows as it is. Without either, a film's BT.709
//! colours go to a P3 screen untouched, too saturated.
//!
//! ponytail: Dolby Vision profile 5 (no HDR10 base: many of the server's WEB-DL "DoVi") shows green and purple, as its
//! reshaping is only in mpv's gpu-next, which libmpv's render API doesn't offer (0.41), nor IINA's; profile 8 shows its
//! HDR10 base. Play those through AVFoundation, or a libmpv whose render API has gpu-next, if they matter.

use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};

use objc2_app_kit::NSScreen;
use objc2_core_foundation::{CFRetained, CFString, Type};
use objc2_core_graphics::{CGColorSpace, kCGColorSpaceDisplayP3_PQ, kCGColorSpaceITUR_2100_PQ, kCGColorSpaceSRGB};

use super::mpv::Mpv;

/// The primaries of an HDR film shown as HDR, each with mpv's name for them and the PQ colour space Core Animation
/// shows them in.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Hdr {
    Bt2020,
    DisplayP3,
}

impl Hdr {
    const ALL: [Hdr; 2] = [Hdr::Bt2020, Hdr::DisplayP3];

    /// A film's, by mpv's video-params: a PQ or an HLG transfer over primaries of these (HLG drawn as PQ, as IINA does).
    pub fn of(gamma: &str, primaries: &str) -> Option<Hdr> {
        Hdr::ALL.into_iter().find(|h| h.mpv() == primaries).filter(|_| ["pq", "hlg"].contains(&gamma))
    }

    fn mpv(self) -> &'static str {
        match self {
            Hdr::Bt2020 => "bt.2020",
            Hdr::DisplayP3 => "display-p3",
        }
    }

    fn space(self) -> &'static CFString {
        match self {
            Hdr::Bt2020 => unsafe { kCGColorSpaceITUR_2100_PQ },
            Hdr::DisplayP3 => unsafe { kCGColorSpaceDisplayP3_PQ },
        }
    }
}

/// What the picture is drawn as on a screen: the layer's colour space and whether it may go past white, set on the
/// main thread, and what mpv draws for it (`target`), on its own.
pub struct Look {
    pub space: CFRetained<CGColorSpace>,
    pub edr: bool,
    pub target: Target,
}

/// What mpv draws a film as: PQ over its primaries, or mapped to the screen's ICC profile (or neither, for a layer in
/// sRGB).
pub struct Target {
    hdr: Option<Hdr>,
    icc: Option<PathBuf>,
}

impl Look {
    /// The look of a film (`hdr`, none for one in SDR or none yet) on `screen`, read on the main thread, in a picture
    /// of float colours or not; the screen's profile kept in `cache` for mpv.
    pub fn on(screen: &NSScreen, hdr: Option<Hdr>, floats: bool, cache: Option<&Path>) -> Look {
        // HDR on a screen that can go past white, in floats, as PQ in 8 bits bands; else mpv tone-maps it to the
        // screen's profile
        let hdr = hdr.filter(|_| floats && screen.maximumPotentialExtendedDynamicRangeColorComponentValue() > 1.0);
        let own = screen.colorSpace();
        let screens = own.as_ref().and_then(|c| c.CGColorSpace()).map(|c| c.retain());
        // mpv maps to the screen's profile only where the layer can be in the screen's space, as the two go together
        let icc = match (hdr, &screens) {
            (None, Some(_)) => own.and_then(|c| c.ICCProfileData()).and_then(|d| kept(&d.to_vec(), cache?)),
            _ => None,
        };
        let space = match hdr {
            Some(hdr) => CGColorSpace::with_name(Some(hdr.space())),
            // with no profile for mpv, sRGB, which Core Animation maps to the screen
            None => icc.as_ref().and(screens),
        };
        Look {
            space: space.or_else(|| CGColorSpace::with_name(Some(unsafe { kCGColorSpaceSRGB }))).expect("sRGB"),
            edr: hdr.is_some(),
            target: Target { hdr, icc },
        }
    }
}

impl Target {
    /// Has mpv draw so: each set, the first refusal told, so one refused leaves the others as they should be.
    pub fn apply(&self, mpv: &Mpv) -> Result<(), String> {
        let icc = self.icc.as_ref().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
        let (prim, trc) = self.hdr.map_or(("auto", "auto"), |h| (h.mpv(), "pq"));
        [("icc-profile", icc.as_str()), ("target-prim", prim), ("target-trc", trc)]
            .map(|(name, value)| mpv.command(&["set", name, value]))
            .into_iter()
            .collect()
    }
}

// A screen's profile as a file in `cache`, which mpv reads: named by its bytes, so another screen's is a new file mpv
// reads, and one there as it should be is never written over, as mpv may be reading it; written through a temp file,
// and again where one there isn't the profile (a power cut's).
// ponytail: a file for each profile ever seen, never swept: 4 KB each, in Caches, which macOS clears; sweep the other
// display-*.icc as one is written if they ever pile up.
fn kept(icc: &[u8], cache: &Path) -> Option<PathBuf> {
    if icc.is_empty() {
        return None;
    }
    let mut hash = DefaultHasher::new();
    icc.hash(&mut hash);
    let path = cache.join(format!("display-{:016x}.icc", hash.finish()));
    if std::fs::read(&path).ok().as_deref() != Some(icc) {
        // the process's own, as the app and its dev build share the cache
        let temp = path.with_extension(format!("{}.part", std::process::id()));
        let written = std::fs::create_dir_all(cache)
            .and_then(|_| std::fs::write(&temp, icc))
            .and_then(|_| std::fs::rename(&temp, &path));
        if let Err(e) = written {
            eprintln!("player: the screen's profile: {e}");
            return None;
        }
    }
    Some(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_film_is_hdr_by_a_pq_or_hlg_transfer_over_wide_primaries() {
        assert_eq!(Hdr::of("pq", "bt.2020"), Some(Hdr::Bt2020));
        assert_eq!(Hdr::of("hlg", "bt.2020"), Some(Hdr::Bt2020));
        assert_eq!(Hdr::of("pq", "display-p3"), Some(Hdr::DisplayP3));
        // SDR, though wide or of an HDR transfer
        assert_eq!(Hdr::of("bt.1886", "bt.2020"), None);
        assert_eq!(Hdr::of("pq", "bt.709"), None);
        assert_eq!(Hdr::of("bt.1886", "bt.709"), None);
    }

    #[test]
    fn a_kept_profile_is_written_once_and_again_where_it_isnt_the_profile() {
        let cache = std::env::temp_dir().join(format!("hoshizora-icc-{}", std::process::id()));
        let icc = b"a profile".to_vec();
        let path = kept(&icc, &cache).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), icc);
        // a power cut's: the name, the bytes gone
        std::fs::write(&path, [0; 9]).unwrap();
        assert_eq!(kept(&icc, &cache), Some(path.clone()));
        assert_eq!(std::fs::read(&path).unwrap(), icc);
        assert_eq!(kept(&[], &cache), None);
        std::fs::remove_dir_all(&cache).unwrap();
    }
}
