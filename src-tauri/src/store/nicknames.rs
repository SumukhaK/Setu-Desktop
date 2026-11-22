//! AD-14: per-workspace nicknames in an atomic JSON file.

use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// Zero-sized error for an invalid nickname. Clippy denies `Result<_, ()>`
/// under `-D warnings`, so this carries the same meaning without a lint allow.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InvalidNickname;

#[derive(Serialize, Deserialize)]
struct File {
    version: u32,
    nicknames: BTreeMap<String, String>,
}

pub struct NicknameStore {
    path: PathBuf,
    lock: Mutex<()>,
}

impl NicknameStore {
    pub fn new(state_dir: &Path) -> Self {
        Self {
            path: state_dir.join("desktop-nicknames.json"),
            lock: Mutex::new(()),
        }
    }

    pub fn load(&self) -> BTreeMap<String, String> {
        let Ok(text) = std::fs::read_to_string(&self.path) else {
            return BTreeMap::new();
        };
        let Ok(file) = serde_json::from_str::<File>(&text) else {
            return BTreeMap::new();
        };
        if file.version != 1 {
            return BTreeMap::new();
        }
        file.nicknames
    }

    pub fn set(&self, device_id: &str, nickname: Option<&str>) -> io::Result<()> {
        let _guard = self
            .lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut nicknames = self.load();
        match nickname {
            Some(name) => {
                nicknames.insert(device_id.to_owned(), name.to_owned());
            }
            None => {
                nicknames.remove(device_id);
            }
        }
        let file = File {
            version: 1,
            nicknames,
        };
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let temp = self.path.with_file_name("desktop-nicknames.json.tmp");
        let mut out = std::fs::File::create(&temp)?;
        serde_json::to_writer_pretty(&mut out, &file).map_err(io::Error::other)?;
        out.sync_all()?;
        drop(out);
        std::fs::rename(&temp, &self.path)?;
        Ok(())
    }
}

pub fn normalize_nickname(raw: &str) -> Result<Option<String>, InvalidNickname> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().count() > 40 || trimmed.chars().any(char::is_control) {
        return Err(InvalidNickname);
    }
    Ok(Some(trimmed.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, NicknameStore) {
        let tmp = tempfile::tempdir().unwrap();
        let state = tmp.path().join("setu").join("solo");
        let store = NicknameStore::new(&state);
        (tmp, store)
    }

    #[test]
    fn a_missing_or_corrupt_file_loads_empty_and_a_set_repairs_it() {
        let (_tmp, store) = store();
        assert!(store.load().is_empty());

        std::fs::create_dir_all(store.path.parent().unwrap()).unwrap();
        std::fs::write(&store.path, "not json").unwrap();
        assert!(store.load().is_empty());

        store.set("pixel-7", Some("Work phone")).unwrap();
        assert_eq!(
            store.load().get("pixel-7").map(String::as_str),
            Some("Work phone")
        );
        let text = std::fs::read_to_string(&store.path).unwrap();
        assert!(text.contains("\"version\": 1"), "unexpected file: {text}");
    }

    #[test]
    fn a_round_trip_and_a_removal_keep_device_ids_byte_exact() {
        let (_tmp, store) = store();
        store.set("Pixel-7", Some("Upper")).unwrap();
        store.set("pixel-7", Some("Lower")).unwrap();
        let loaded = store.load();
        assert_eq!(loaded.get("Pixel-7").map(String::as_str), Some("Upper"));
        assert_eq!(loaded.get("pixel-7").map(String::as_str), Some("Lower"));

        store.set("pixel-7", None).unwrap();
        let loaded = store.load();
        assert!(loaded.contains_key("Pixel-7"));
        assert!(!loaded.contains_key("pixel-7"));
    }

    #[test]
    fn normalize_nickname_trims_and_rejects_bad_values() {
        assert_eq!(
            normalize_nickname("  Work phone "),
            Ok(Some("Work phone".to_owned()))
        );
        assert_eq!(normalize_nickname(""), Ok(None));
        assert_eq!(normalize_nickname("   "), Ok(None));
        assert_eq!(normalize_nickname(&"x".repeat(41)), Err(InvalidNickname));
        assert_eq!(normalize_nickname("a\nb"), Err(InvalidNickname));
    }
}
