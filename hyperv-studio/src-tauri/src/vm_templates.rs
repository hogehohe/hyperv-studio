use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const REGISTRY_FILE: &str = "vm-templates.json";
const LOCK_FILE: &str = "vm-templates.lock";
const MAX_REGISTRY_BYTES: u64 = 2 * 1024 * 1024;
const MAX_TEMPLATES: usize = 4096;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TemplateInfo {
    pub vm_id: String,
    pub registered_name: String,
    pub registered_at: u64,
}

pub struct NativeVm {
    pub id: String,
    pub name: String,
    pub state: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredRegistry {
    version: u32,
    #[serde(deserialize_with = "unique_templates")]
    templates: BTreeMap<String, TemplateInfo>,
}

fn unique_templates<'de, D>(deserializer: D) -> Result<BTreeMap<String, TemplateInfo>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct UniqueMap;
    impl<'de> serde::de::Visitor<'de> for UniqueMap {
        type Value = BTreeMap<String, TemplateInfo>;
        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("a map of unique VM IDs")
        }
        fn visit_map<M>(self, mut map: M) -> Result<Self::Value, M::Error>
        where
            M: serde::de::MapAccess<'de>,
        {
            let mut entries = BTreeMap::new();
            while let Some((key, value)) = map.next_entry::<String, TemplateInfo>()? {
                if entries.len() >= MAX_TEMPLATES || entries.insert(key, value).is_some() {
                    return Err(serde::de::Error::custom(
                        "duplicate or excessive VM template entries",
                    ));
                }
            }
            Ok(entries)
        }
    }
    deserializer.deserialize_map(UniqueMap)
}

pub fn canonical_id(id: &str) -> Result<String, String> {
    if id.len() != 36
        || !id.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
    {
        return Err("VM ID の形式が正しくありません。".into());
    }
    Uuid::parse_str(id)
        .map(|id| id.hyphenated().to_string())
        .map_err(|_| "VM ID の形式が正しくありません。".into())
}

fn is_reparse(info: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        info.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        info.file_type().is_symlink()
    }
}

fn check_file(info: &fs::Metadata) -> Result<(), String> {
    if !info.is_file() || is_reparse(info) {
        return Err("テンプレート管理ファイルが通常のファイルではありません。".into());
    }
    Ok(())
}

fn safe_open(path: &Path, create: bool, exclusive: bool) -> Result<File, String> {
    // Reject junctions and symbolic links before opening. OPEN_REPARSE_POINT also
    // prevents following a link substituted between this check and the open.
    match fs::symlink_metadata(path) {
        Ok(info) => check_file(&info)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
        Err(error) => return Err(format!("テンプレート管理ファイルを確認できません: {error}")),
    }
    let mut options = OpenOptions::new();
    options.read(true).write(create).create(create);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x0020_0000); // FILE_FLAG_OPEN_REPARSE_POINT
        if exclusive {
            options.share_mode(0);
        }
    }
    #[cfg(not(windows))]
    let _ = exclusive;
    let file = options.open(path).map_err(|error| {
        format!("テンプレート管理ファイルのロックまたは読み込みに失敗しました。別のウィンドウで操作中の場合は完了後に再実行してください: {error}")
    })?;
    check_file(
        &file
            .metadata()
            .map_err(|error| format!("テンプレート管理ファイルを確認できません: {error}"))?,
    )?;
    Ok(file)
}

fn ensure_root(root: &Path) -> Result<PathBuf, String> {
    // The registry is owned by this app. Do not follow redirected app-data
    // directories while running elevated.
    if !root.is_absolute() {
        return Err("テンプレート保存先が絶対パスではありません。".into());
    }
    for ancestor in root.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(info) if is_reparse(&info) || !info.is_dir() => {
                return Err(
                    "テンプレート保存先に通常のフォルダーではないパスが含まれています。".into(),
                );
            }
            Ok(_) => (),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => return Err(format!("テンプレート保存先を確認できません: {error}")),
        }
    }
    fs::create_dir_all(root)
        .map_err(|error| format!("テンプレート保存先を作成できません: {error}"))?;
    let info = fs::symlink_metadata(root)
        .map_err(|error| format!("テンプレート保存先を確認できません: {error}"))?;
    if !info.is_dir() || is_reparse(&info) {
        return Err("テンプレート保存先が通常のフォルダーではありません。".into());
    }
    fs::canonicalize(root).map_err(|error| format!("テンプレート保存先を確認できません: {error}"))
}

pub struct Registry {
    root: PathBuf,
    // Keep the OS lock alive across the native operation, not just JSON access.
    _lock: File,
    entries: BTreeMap<String, TemplateInfo>,
}

impl Registry {
    pub fn open(root: &Path) -> Result<Self, String> {
        let root = ensure_root(root)?;
        let lock = safe_open(&root.join(LOCK_FILE), true, true)?;
        let path = root.join(REGISTRY_FILE);
        let entries = match fs::symlink_metadata(&path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
            Err(error) => {
                return Err(format!(
                    "テンプレート登録情報を確認できません。VMの変更を中止しました: {error}"
                ))
            }
            Ok(_) => {
                let file = safe_open(&path, false, true)?;
                let info = file
                    .metadata()
                    .map_err(|error| format!("テンプレート登録情報を確認できません: {error}"))?;
                if info.len() > MAX_REGISTRY_BYTES {
                    return Err(
                        "テンプレート登録情報が大きすぎます。VMの変更を中止しました。".into(),
                    );
                }
                let mut bytes = Vec::new();
                file.take(MAX_REGISTRY_BYTES + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|error| {
                        format!("テンプレート登録情報を読めません。VMの変更を中止しました: {error}")
                    })?;
                if bytes.len() as u64 > MAX_REGISTRY_BYTES {
                    return Err(
                        "テンプレート登録情報が大きすぎます。VMの変更を中止しました。".into(),
                    );
                }
                let stored: StoredRegistry = serde_json::from_slice(&bytes)
                    .map_err(|error| format!("テンプレート登録情報が壊れています。VMの変更を中止しました。管理ファイルを確認してください: {error}"))?;
                if stored.version != 1 {
                    return Err("未対応のテンプレート登録情報です。VMの変更を中止しました。".into());
                }
                for (id, entry) in &stored.templates {
                    if canonical_id(id)? != *id
                        || entry.vm_id != *id
                        || entry.registered_name.trim().is_empty()
                        || entry.registered_name.chars().count() > 256
                        || entry.registered_name.chars().any(char::is_control)
                        || entry.registered_at == 0
                    {
                        return Err(
                            "テンプレート登録情報が一致しません。VMの変更を中止しました。".into(),
                        );
                    }
                }
                stored.templates
            }
        };
        Ok(Self {
            root,
            _lock: lock,
            entries,
        })
    }

    pub fn list(&self) -> Vec<TemplateInfo> {
        let mut entries: Vec<_> = self.entries.values().cloned().collect();
        entries.sort_by(|a, b| {
            a.registered_name
                .cmp(&b.registered_name)
                .then(a.vm_id.cmp(&b.vm_id))
        });
        entries
    }

    pub fn ensure_unprotected(&self, id: &str) -> Result<(), String> {
        let id = canonical_id(id)?;
        if self.entries.contains_key(&id) {
            return Err("このVMはテンプレートとして保護されています。変更するにはテンプレート登録を解除してください。".into());
        }
        Ok(())
    }

    pub fn register<F>(
        &mut self,
        id: &str,
        confirmation_name: &str,
        resolve: F,
    ) -> Result<Vec<TemplateInfo>, String>
    where
        F: FnOnce(&str) -> Result<Option<NativeVm>, String>,
    {
        let id = canonical_id(id)?;
        if self.entries.contains_key(&id) {
            return Err("このVMは既にテンプレートとして登録されています。".into());
        }
        if self.entries.len() >= MAX_TEMPLATES {
            return Err("テンプレートの登録数が上限に達しています。".into());
        }
        let vm = resolve(&id)?.ok_or("登録対象のVMが見つかりません。VM一覧を更新してください。")?;
        if canonical_id(&vm.id)? != id {
            return Err("登録対象のVM ID が一致しません。".into());
        }
        if vm.name != confirmation_name {
            return Err(
                "確認用のVM名が現在のVM名と一致しません。VM一覧を更新してください。".into(),
            );
        }
        if vm.name.trim().is_empty()
            || vm.name.chars().count() > 256
            || vm.name.chars().any(char::is_control)
        {
            return Err("現在のVM名をテンプレート登録情報に保存できません。".into());
        }
        if vm.state != "Off" {
            return Err(
                "テンプレートに登録する前にVMを停止してください。自動停止は行いません。".into(),
            );
        }
        let registered_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "システム時刻を確認できません。".to_string())?
            .as_secs();
        let mut entries = self.entries.clone();
        entries.insert(
            id.clone(),
            TemplateInfo {
                vm_id: id,
                registered_name: vm.name,
                registered_at,
            },
        );
        self.save(entries)?;
        Ok(self.list())
    }

    pub fn unregister<F>(
        &mut self,
        id: &str,
        confirmation_name: &str,
        resolve: F,
    ) -> Result<Vec<TemplateInfo>, String>
    where
        F: FnOnce(&str) -> Result<Option<NativeVm>, String>,
    {
        let id = canonical_id(id)?;
        let entry = self
            .entries
            .get(&id)
            .ok_or("このVMはテンプレートに登録されていません。一覧を更新してください。")?;
        let expected_name = match resolve(&id)? {
            Some(vm) => {
                if canonical_id(&vm.id)? != id {
                    return Err("解除対象のVM ID が一致しません。".into());
                }
                vm.name
            }
            None => entry.registered_name.clone(),
        };
        if expected_name != confirmation_name {
            return Err("確認用のVM名が一致しません。VM一覧を更新してください。".into());
        }
        let mut entries = self.entries.clone();
        entries.remove(&id);
        self.save(entries)?;
        Ok(self.list())
    }

    fn save(&mut self, entries: BTreeMap<String, TemplateInfo>) -> Result<(), String> {
        let stored = StoredRegistry {
            version: 1,
            templates: entries.clone(),
        };
        let bytes = serde_json::to_vec_pretty(&stored)
            .map_err(|error| format!("テンプレート登録情報を保存できません: {error}"))?;
        if bytes.len() as u64 > MAX_REGISTRY_BYTES {
            return Err("テンプレート登録情報が大きすぎます。".into());
        }
        let destination = self.root.join(REGISTRY_FILE);
        match fs::symlink_metadata(&destination) {
            Ok(info) => check_file(&info)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => return Err(format!("テンプレート登録情報を確認できません: {error}")),
        }
        let temporary = self
            .root
            .join(format!(".vm-templates-{}.tmp", Uuid::new_v4().simple()));
        let result = (|| {
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(windows)]
            {
                use std::os::windows::fs::OpenOptionsExt;
                options.share_mode(0).custom_flags(0x0020_0000);
            }
            let mut file = options.open(&temporary).map_err(|error| {
                format!("テンプレート登録情報の一時ファイルを作成できません: {error}")
            })?;
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|error| format!("テンプレート登録情報を書き込めません: {error}"))?;
            drop(file);
            replace_atomically(&temporary, &destination)
        })();
        if result.is_err() {
            // Only this unique file is ours. Never recursively clean app data.
            if fs::symlink_metadata(&temporary)
                .is_ok_and(|info| info.is_file() && !is_reparse(&info))
            {
                let _ = fs::remove_file(&temporary);
            }
        }
        result?;
        self.entries = entries;
        Ok(())
    }
}

#[cfg(windows)]
fn replace_atomically(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, new_name: *const u16, flags: u32) -> i32;
    }
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    if unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), 0x1 | 0x8) } == 0 {
        return Err(format!(
            "テンプレート登録情報を更新できません。以前の登録情報は保持されています: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_atomically(source: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(source, destination)
        .map_err(|error| format!("テンプレート登録情報を更新できません: {error}"))
}

pub fn with_unprotected<T, F>(root: &Path, id: &str, action: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String>,
{
    canonical_id(id)?;
    let registry = Registry::open(root)?;
    registry.ensure_unprotected(id)?;
    // The binding remains alive until the native action has returned.
    action()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    const ID: &str = "c523a297-4a1d-4ff8-ad96-915f76c74a3c";
    const OTHER_ID: &str = "5e40a9a8-e1fe-4aee-8ee4-75b0dbd0c73c";
    struct TestRoot(PathBuf);
    impl TestRoot {
        fn new() -> Self {
            let root = std::env::temp_dir()
                .join(format!("hyperv-template-test-{}", Uuid::new_v4().simple()));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
        fn path(&self) -> &Path {
            &self.0
        }
        fn registry_path(&self) -> PathBuf {
            self.0.join(REGISTRY_FILE)
        }
    }
    impl Drop for TestRoot {
        fn drop(&mut self) {
            // Test-owned, uniquely named direct children only.
            if let Ok(entries) = fs::read_dir(&self.0) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if fs::symlink_metadata(&path)
                        .is_ok_and(|info| info.is_dir() && !is_reparse(&info))
                    {
                        let _ = fs::remove_dir(path);
                    } else {
                        let _ = fs::remove_file(path);
                    }
                }
            }
            let _ = fs::remove_dir(&self.0);
        }
    }
    fn vm(name: &str, state: &str) -> NativeVm {
        NativeVm {
            id: ID.into(),
            name: name.into(),
            state: state.into(),
        }
    }
    fn register(root: &TestRoot) {
        Registry::open(root.path())
            .unwrap()
            .register(ID, "origin", |_| Ok(Some(vm("origin", "Off"))))
            .unwrap();
    }

    #[test]
    fn template_ids_are_strict_and_case_normalized() {
        assert_eq!(canonical_id(&ID.to_uppercase()).unwrap(), ID);
        for invalid in [
            "origin",
            "../vm",
            "{c523a297-4a1d-4ff8-ad96-915f76c74a3c}",
            "c523a2974a1d4ff8ad96915f76c74a3c",
        ] {
            assert!(canonical_id(invalid).is_err());
        }
    }

    #[test]
    fn missing_registry_is_empty_and_does_not_create_or_reset_json() {
        let root = TestRoot::new();
        assert!(Registry::open(root.path()).unwrap().list().is_empty());
        assert!(!root.registry_path().exists());
        assert!(root.0.join(LOCK_FILE).is_file());
    }

    #[test]
    fn registration_round_trips_and_keeps_original_metadata() {
        let root = TestRoot::new();
        let mut registry = Registry::open(root.path()).unwrap();
        let list = registry
            .register(&ID.to_uppercase(), "origin", |_| {
                Ok(Some(vm("origin", "Off")))
            })
            .unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].vm_id, ID);
        assert_eq!(list[0].registered_name, "origin");
        assert!(list[0].registered_at > 0);
        let before = fs::read(root.registry_path()).unwrap();
        assert!(registry
            .register(ID, "origin", |_| panic!(
                "duplicate registration must not resolve VM"
            ))
            .is_err());
        assert_eq!(fs::read(root.registry_path()).unwrap(), before);
        drop(registry);
        assert_eq!(Registry::open(root.path()).unwrap().list(), list);
        assert!(!fs::read_dir(root.path()).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")));
    }

    #[test]
    fn registration_requires_fresh_off_vm_exact_name_and_id() {
        let root = TestRoot::new();
        let mut registry = Registry::open(root.path()).unwrap();
        for state in ["Running", "Saved", "Paused", "Stopping", "off"] {
            assert!(registry
                .register(ID, "origin", |_| Ok(Some(vm("origin", state))))
                .is_err());
        }
        for confirmation in ["Origin", "origin ", "", "stale-name"] {
            assert!(registry
                .register(ID, confirmation, |_| Ok(Some(vm("origin", "Off"))))
                .is_err());
        }
        assert!(registry.register(ID, "origin", |_| Ok(None)).is_err());
        assert!(registry
            .register(ID, "origin", |_| Err("native access denied".into()))
            .is_err());
        assert!(registry
            .register(ID, "origin", |_| Ok(Some(NativeVm {
                id: OTHER_ID.into(),
                ..vm("origin", "Off")
            })))
            .is_err());
        assert!(registry.list().is_empty());
        assert!(!root.registry_path().exists());
    }

    #[test]
    fn invalid_id_does_not_create_files_or_invoke_action() {
        let root = TestRoot::new();
        let called = Cell::new(false);
        assert!(with_unprotected(root.path(), "../origin", || {
            called.set(true);
            Ok(())
        })
        .is_err());
        assert!(!called.get());
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
    }

    #[test]
    fn stale_client_protected_action_is_rejected_before_native_call() {
        let root = TestRoot::new();
        register(&root);
        let called = Cell::new(false);
        let error = with_unprotected(root.path(), &ID.to_uppercase(), || {
            called.set(true);
            Ok(())
        })
        .unwrap_err();
        assert!(error.contains("保護"));
        assert!(!called.get());
        assert_eq!(
            with_unprotected(root.path(), OTHER_ID, || Ok(42)).unwrap(),
            42
        );
        assert_eq!(Registry::open(root.path()).unwrap().list().len(), 1);
    }

    #[cfg(windows)]
    #[test]
    fn os_lock_spans_native_action_and_is_released_after_result_or_error() {
        let root = TestRoot::new();
        with_unprotected(root.path(), ID, || {
            assert!(Registry::open(root.path()).is_err());
            Ok(())
        })
        .unwrap();
        assert!(Registry::open(root.path()).is_ok());
        let result: Result<(), String> = with_unprotected(root.path(), ID, || {
            assert!(Registry::open(root.path()).is_err());
            Err("native failure".into())
        });
        assert_eq!(result.unwrap_err(), "native failure");
        assert!(Registry::open(root.path()).is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn second_instance_cannot_read_or_write_while_registry_is_locked() {
        let root = TestRoot::new();
        let registry = Registry::open(root.path()).unwrap();
        assert!(Registry::open(root.path()).is_err());
        drop(registry);
        register(&root);
        assert_eq!(Registry::open(root.path()).unwrap().list().len(), 1);
    }

    #[test]
    fn unregister_uses_current_name_and_allows_running_vm() {
        let root = TestRoot::new();
        register(&root);
        let mut registry = Registry::open(root.path()).unwrap();
        let before = fs::read(root.registry_path()).unwrap();
        assert!(registry
            .unregister(ID, "origin", |_| Ok(Some(vm(
                "externally-renamed",
                "Running"
            ))))
            .is_err());
        assert_eq!(fs::read(root.registry_path()).unwrap(), before);
        assert!(registry
            .unregister(ID, "externally-renamed", |_| Ok(Some(vm(
                "externally-renamed",
                "Running"
            ))))
            .unwrap()
            .is_empty());
        drop(registry);
        assert!(Registry::open(root.path()).unwrap().list().is_empty());
        assert!(with_unprotected(root.path(), ID, || Ok(())).is_ok());
    }

    #[test]
    fn missing_external_vm_is_retained_until_explicit_exact_unregister() {
        let root = TestRoot::new();
        register(&root);
        let mut registry = Registry::open(root.path()).unwrap();
        assert_eq!(registry.list().len(), 1);
        let before = fs::read(root.registry_path()).unwrap();
        assert!(registry.unregister(ID, "different", |_| Ok(None)).is_err());
        assert!(registry
            .unregister(ID, "origin", |_| Err(
                "cannot verify native inventory".into()
            ))
            .is_err());
        assert_eq!(fs::read(root.registry_path()).unwrap(), before);
        assert!(registry
            .unregister(ID, "origin", |_| Ok(None))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn invalid_registry_always_fails_closed_without_native_action_or_reset() {
        let entry = format!(r#"{{"vm_id":"{ID}","registered_name":"origin","registered_at":1}}"#);
        let valid = format!(r#"{{"version":1,"templates":{{"{ID}":{entry}}}}}"#);
        let cases = vec![
            "".to_string(),
            "{".to_string(),
            "[]".to_string(),
            valid.replace("\"version\":1", "\"version\":2"),
            valid.replace("\"version\":1", "\"unknown\":true,\"version\":1"),
            format!(r#"{{"version":1,"templates":{{"{ID}":{entry},"{ID}":{entry}}}}}"#),
            valid.replace("\"registered_at\":1", "\"registered_at\":0"),
            valid.replace("\"registered_name\":\"origin\"", "\"registered_name\":\"\""),
            valid.replacen(&format!("\"{ID}\":"), &format!("\"{OTHER_ID}\":"), 1),
            valid.replacen(
                &format!("\"{ID}\":"),
                &format!("\"{}\":", ID.to_uppercase()),
                1,
            ),
        ];
        for bytes in cases {
            let root = TestRoot::new();
            fs::write(root.registry_path(), &bytes).unwrap();
            let called = Cell::new(false);
            assert!(Registry::open(root.path()).is_err(), "accepted {bytes}");
            assert!(with_unprotected(root.path(), OTHER_ID, || {
                called.set(true);
                Ok(())
            })
            .is_err());
            assert!(!called.get());
            assert_eq!(fs::read_to_string(root.registry_path()).unwrap(), bytes);
        }
    }

    #[test]
    fn oversized_registry_is_not_loaded_or_reset() {
        let root = TestRoot::new();
        fs::write(
            root.registry_path(),
            vec![b' '; MAX_REGISTRY_BYTES as usize + 1],
        )
        .unwrap();
        assert!(Registry::open(root.path()).is_err());
        assert_eq!(
            fs::metadata(root.registry_path()).unwrap().len(),
            MAX_REGISTRY_BYTES + 1
        );
    }

    #[test]
    fn registry_or_lock_directory_cannot_be_treated_as_missing_information() {
        let root = TestRoot::new();
        fs::create_dir(root.registry_path()).unwrap();
        assert!(Registry::open(root.path()).is_err());
        fs::remove_dir(root.registry_path()).unwrap();
        fs::remove_file(root.0.join(LOCK_FILE)).unwrap();
        fs::create_dir(root.0.join(LOCK_FILE)).unwrap();
        assert!(Registry::open(root.path()).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn failed_atomic_replacement_keeps_disk_and_memory_snapshot() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = TestRoot::new();
        register(&root);
        let mut registry = Registry::open(root.path()).unwrap();
        let before = fs::read(root.registry_path()).unwrap();
        let blocking_handle = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(root.registry_path())
            .unwrap();
        assert!(registry.unregister(ID, "origin", |_| Ok(None)).is_err());
        assert_eq!(registry.list().len(), 1);
        drop(blocking_handle);
        assert_eq!(fs::read(root.registry_path()).unwrap(), before);
        assert!(!fs::read_dir(root.path()).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")));
    }
}
