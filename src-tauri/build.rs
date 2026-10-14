// Each command the pages may call, and the capability that grants it, so it's granted only there: the main window's
// (capabilities/default.json) Emby's and opening the player, the player's (capabilities/player.json) none of Emby's.
const COMMANDS: &[(&str, &str)] = &[
  ("emby_servers", MAIN),
  ("emby_add", MAIN),
  ("emby_edit", MAIN),
  ("emby_remove", MAIN),
  ("emby_status", MAIN),
  ("emby_libraries", MAIN),
  ("emby_items", MAIN),
  ("emby_sources", MAIN),
  ("emby_episodes", MAIN),
  ("emby_versions", MAIN),
  ("player_open", MAIN),
  ("player_state", PLAYER),
  ("player_command", PLAYER),
];
const MAIN: &str = "capabilities/default.json";
const PLAYER: &str = "capabilities/player.json";

fn main() {
  // A command src/lib.rs has but this list doesn't, or its capability doesn't, would be turned down when a page calls it,
  // and it'd only say 连接异常; one the other capability has too would be a window's that isn't; so the build stops.
  println!("cargo:rerun-if-changed=src/lib.rs");
  let lib = std::fs::read_to_string("src/lib.rs").expect("src/lib.rs");
  let read = |c: &str| std::fs::read_to_string(c).unwrap_or_else(|_| panic!("{c}"));
  let (main, player) = (read(MAIN), read(PLAYER));
  let handled = lib.split("#[tauri::command").skip(1).filter_map(|f| f.split("fn ").nth(1)?.split(['(', '<']).next());
  for name in handled {
    let Some(&(_, own)) = COMMANDS.iter().find(|(c, _)| *c == name) else {
      panic!("{name} is a command, but not in build.rs's COMMANDS")
    };
    let allow = format!("\"allow-{}\"", name.replace('_', "-"));
    let (granted, other) = if own == MAIN { (&main, &player) } else { (&player, &main) };
    assert!(granted.contains(&allow), "{name} is a command, but {own} has no {allow}");
    assert!(!other.contains(&allow), "{name} is granted beyond {own}");
  }
  // libmpv, from Homebrew's mpv (brew install mpv), for the player: where Homebrew puts it on Apple silicon, and on Intel
  // ponytail: the app finds it where Homebrew put it, so only on a Mac with mpv installed; bundle libmpv and its
  // libraries into the app when it goes to another Mac (docs/playback-plan.md, 以后)
  println!("cargo:rustc-link-search=native=/opt/homebrew/lib");
  println!("cargo:rustc-link-search=native=/usr/local/lib");
  let names = COMMANDS.iter().map(|(name, _)| *name).collect::<Vec<_>>().leak();
  let manifest = tauri_build::AppManifest::new().commands(names);
  tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest)).expect("failed to run tauri-build");
}
