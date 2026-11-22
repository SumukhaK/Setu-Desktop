//! AD-14: per-workspace nicknames in an atomic JSON file.

use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

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
        BTreeMap::new()
    }

    pub fn set(&self, _device_id: &str, _nickname: Option<&str>) -> io::Result<()> {
        Ok(())
    }
}

pub fn normalize_nickname(_raw: &str) -> Result<Option<String>, ()> {
    Ok(None)
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
        assert_eq!(normalize_nickname(&"x".repeat(41)), Err(()));
        assert_eq!(normalize_nickname("a\nb"), Err(()));
    }
}
