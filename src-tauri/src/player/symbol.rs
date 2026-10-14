//! The Mac's own symbols (SF Symbols) for the player's page, drawn by AppKit as its controls draw them, white:
//! `symbol://localhost/<name>?size=<points>&weight=medium` (regular without), a PNG at twice that size, which the page
//! shows at its size (a `2x` source). None ships with the app, so they're the system's, as it updates them.

use std::ptr::null_mut;

use objc2::AnyThread;
use objc2::rc::autoreleasepool;
use objc2_app_kit::{
    NSBitmapImageFileType, NSBitmapImageRep, NSColor, NSCompositingOperation, NSDeviceRGBColorSpace, NSFontWeightMedium,
    NSFontWeightRegular, NSGraphicsContext, NSImage, NSImageSymbolConfiguration, NSImageSymbolScale,
    NSRectFillUsingOperation,
};
use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize, NSString};
use tauri::http::{Request, Response, header};

pub fn symbol(webview: &str, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    // the player's window's alone, as nothing else draws with them
    if webview != super::LABEL {
        return Response::builder().status(403).body(vec![]).unwrap_or_default();
    }
    let uri = request.uri();
    let (mut size, mut weight) = (13.0, unsafe { NSFontWeightRegular });
    for (key, value) in uri.query().unwrap_or_default().split('&').filter_map(|pair| pair.split_once('=')) {
        match (key, value) {
            // whole points, as large as a control's symbol could want, so no page can ask for a bitmap past that
            ("size", points) => {
                size = points.parse().ok().filter(|v: &f64| v.is_finite()).map_or(size, |v| v.clamp(1.0, 64.0).round())
            }
            ("weight", "medium") => weight = unsafe { NSFontWeightMedium },
            _ => {}
        }
    }
    match png(uri.path().trim_start_matches('/'), size, weight) {
        // the same while the system is: WebKit keeps each for the page's life (in memory; nothing of a custom scheme
        // goes to its disk cache, so a system update's show at the next launch), and an icon toggled back asks no more
        Some(png) => Response::builder()
            .header(header::CONTENT_TYPE, "image/png")
            .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
            .body(png),
        None => Response::builder().status(404).body(vec![]),
    }
    .unwrap_or_default()
}

// The symbol `name` at `size` points, as a PNG of twice that many pixels, white where it's drawn.
fn png(name: &str, size: f64, weight: f64) -> Option<Vec<u8>> {
    // what AppKit lets go of here goes as each is drawn, as a pooled thread may live on
    autoreleasepool(|_| {
        let configuration =
            NSImageSymbolConfiguration::configurationWithPointSize_weight_scale(size, weight, NSImageSymbolScale::Medium);
        let image = NSImage::imageWithSystemSymbolName_accessibilityDescription(&NSString::from_str(name), None)?
            .imageWithSymbolConfiguration(&configuration)?;
        let points = image.size();
        let (wide, high) = ((points.width * 2.0).ceil(), (points.height * 2.0).ceil());
        let bitmap = unsafe {
            NSBitmapImageRep::initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel(
                NSBitmapImageRep::alloc(),
                null_mut(),
                wide as isize,
                high as isize,
                8,
                4,
                true,
                false,
                NSDeviceRGBColorSpace,
                0,
                0,
            )
        }?;
        // drawn in points, two pixels to each
        bitmap.setSize(NSSize::new(wide / 2.0, high / 2.0));
        let context = NSGraphicsContext::graphicsContextWithBitmapImageRep(&bitmap)?;
        NSGraphicsContext::saveGraphicsState_class();
        NSGraphicsContext::setCurrentContext(Some(&context));
        // in the middle of its whole pixels, as a button centres the picture
        let at = NSPoint::new((wide / 2.0 - points.width) / 2.0, (high / 2.0 - points.height) / 2.0);
        let drawn = NSRect::new(at, points);
        image.drawInRect(drawn);
        NSColor::whiteColor().set();
        NSRectFillUsingOperation(drawn, NSCompositingOperation::SourceIn);
        NSGraphicsContext::restoreGraphicsState_class();
        let png =
            unsafe { bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }?;
        Some(png.to_vec())
    })
}

#[cfg(test)]
mod tests {
    use objc2_foundation::NSData;

    use super::*;

    #[test]
    fn a_symbol_is_drawn_white_for_the_player_and_one_the_system_lacks_is_not_found() {
        let ask = |webview: &str, uri: &str| symbol(webview, &Request::builder().uri(uri).body(vec![]).unwrap());
        let drawn = ask("player", "symbol://localhost/play.fill?size=20&weight=medium");
        assert_eq!(drawn.status(), 200);
        assert_eq!(drawn.headers()[header::CONTENT_TYPE], "image/png");
        // read back, some of it white, so a drawing that lands nowhere doesn't pass as a PNG of nothing
        let read = NSBitmapImageRep::imageRepWithData(&NSData::with_bytes(drawn.body())).unwrap();
        let lit = (0..read.pixelsWide())
            .flat_map(|x| (0..read.pixelsHigh()).map(move |y| (x, y)))
            .filter_map(|(x, y)| read.colorAtX_y(x, y))
            .any(|c| c.alphaComponent() > 0.9 && c.redComponent() > 0.9 && c.blueComponent() > 0.9);
        assert!(lit);
        assert_eq!(ask("player", "symbol://localhost/no.such.symbol?size=20").status(), 404);
        assert_eq!(ask("main", "symbol://localhost/play.fill?size=20").status(), 403);
    }
}
