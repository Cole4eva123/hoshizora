// Each command the pages may call, so it's granted only where a capability names it (capabilities/default.json): a
// window added later (the player) gets none of them till its own capability asks.
const COMMANDS: &[&str] = &[
  "emby_servers",
  "emby_add",
  "emby_edit",
  "emby_remove",
  "emby_status",
  "emby_libraries",
  "emby_items",
  "emby_sources",
  "emby_episodes",
  "emby_versions",
];

fn main() {
  // A command src/lib.rs has but this list or the capability doesn't would be turned down when the pages call it, and
  // they'd only say 连接异常; so the build stops instead.
  println!("cargo:rerun-if-changed=src/lib.rs");
  let lib = std::fs::read_to_string("src/lib.rs").expect("src/lib.rs");
  let capability = std::fs::read_to_string("capabilities/default.json").expect("capabilities/default.json");
  let handled = lib.split("#[tauri::command").skip(1).filter_map(|f| f.split("fn ").nth(1)?.split(['(', '<']).next());
  for name in handled {
    assert!(COMMANDS.contains(&name), "{name} is a command, but not in build.rs's COMMANDS");
    let allow = format!("\"allow-{}\"", name.replace('_', "-"));
    assert!(capability.contains(&allow), "{name} is a command, but capabilities/default.json has no {allow}");
  }
  let manifest = tauri_build::AppManifest::new().commands(COMMANDS);
  tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest)).expect("failed to run tauri-build");
}
