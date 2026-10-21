use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const IMAGE_FILE: &str = "image.iso";
const METADATA_FILE: &str = "metadata.json";
const COPY_BUFFER_SIZE: usize = 4 * 1024 * 1024;
const PROGRESS_INTERVAL: u64 = 32 * 1024 * 1024;
const MAX_METADATA_BYTES: u64 = 64 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OsFamily {
    Windows,
    Linux,
    Other,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct IsoImage {
    pub id: String,
    pub name: String,
    pub os_family: OsFamily,
    pub file_name: String,
    pub size_bytes: u64,
    pub imported_at: u64,
    pub available: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct IsoLibrary {
    pub directory: String,
    pub images: Vec<IsoImage>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ImportIsoRequest {
    pub source_path: String,
    pub name: String,
    pub os_family: OsFamily,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub struct IsoImportProgress {
    pub copied_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Deserialize, Serialize)]
struct StoredIso {
    id: String,
    name: String,
    os_family: OsFamily,
    file_name: String,
    size_bytes: u64,
    imported_at: u64,
}

impl StoredIso {
    fn into_image(self, available: bool) -> IsoImage {
        IsoImage {
            id: self.id,
            name: self.name,
            os_family: self.os_family,
            file_name: self.file_name,
            size_bytes: self.size_bytes,
            imported_at: self.imported_at,
            available,
        }
    }
}

struct StagingDirectory {
    root: PathBuf,
    path: PathBuf,
    committed: bool,
}

impl Drop for StagingDirectory {
    fn drop(&mut self) {
        if self.committed {
            return;
        }
        let safe_to_clean = fs::symlink_metadata(&self.path)
            .ok()
            .is_some_and(|info| info.is_dir() && !info.file_type().is_symlink())
            && fs::canonicalize(&self.path)
                .ok()
                .is_some_and(|path| path.parent() == Some(self.root.as_path()));
        if !safe_to_clean {
            return;
        }
        // Only remove files this import created. Never recursively delete a directory
        // that another process might have replaced with a junction or symlink.
        let _ = fs::remove_file(self.path.join(IMAGE_FILE));
        let _ = fs::remove_file(self.path.join(METADATA_FILE));
        let _ = fs::remove_dir(&self.path);
    }
}

fn io_error(context: &str, error: std::io::Error) -> String {
    format!("{context}: {error}")
}

fn ensure_root(root: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(root).map_err(|error| io_error("ISO 保存先を作成できません", error))?;
    let info = fs::symlink_metadata(root)
        .map_err(|error| io_error("ISO 保存先を確認できません", error))?;
    if info.file_type().is_symlink() || !info.is_dir() {
        return Err("ISO 保存先が通常のフォルダーではありません。".into());
    }
    fs::canonicalize(root).map_err(|error| io_error("ISO 保存先を確認できません", error))
}

fn valid_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn checked_item_dir(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("ISO ID の形式が正しくありません。".into());
    }
    let path = root.join(id);
    let info =
        fs::symlink_metadata(&path).map_err(|error| io_error("ISO を確認できません", error))?;
    if info.file_type().is_symlink() || !info.is_dir() {
        return Err("ISO 保存フォルダーの形式が正しくありません。".into());
    }
    let canonical =
        fs::canonicalize(&path).map_err(|error| io_error("ISO を確認できません", error))?;
    if canonical.parent() != Some(root) {
        return Err("ISO 保存先の外側は参照できません。".into());
    }
    Ok(path)
}

fn regular_file_info(path: &Path) -> Result<fs::Metadata, String> {
    let info = fs::symlink_metadata(path)
        .map_err(|error| io_error("ISO ファイルを確認できません", error))?;
    if info.file_type().is_symlink() || !info.is_file() {
        return Err("ISO ファイルが通常のファイルではありません。".into());
    }
    Ok(info)
}

fn has_volume_marker(file: &mut File) -> Result<bool, String> {
    const SECTOR: u64 = 2048;
    const FIRST_DESCRIPTOR: u64 = 16;
    const DESCRIPTORS_TO_CHECK: usize = 64;
    file.seek(SeekFrom::Start(FIRST_DESCRIPTOR * SECTOR))
        .map_err(|error| io_error("ISO の形式を検査できません", error))?;
    let mut sector = [0u8; SECTOR as usize];
    for _ in 0..DESCRIPTORS_TO_CHECK {
        match file.read_exact(&mut sector) {
            Ok(()) => {
                if (&sector[1..6] == b"CD001" && (sector[0] == 1 || sector[0] == 2))
                    || &sector[1..6] == b"NSR02"
                    || &sector[1..6] == b"NSR03"
                {
                    file.seek(SeekFrom::Start(0))
                        .map_err(|error| io_error("ISO を読み戻せません", error))?;
                    return Ok(true);
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(error) => return Err(io_error("ISO の形式を検査できません", error)),
        }
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|error| io_error("ISO を読み戻せません", error))?;
    Ok(false)
}

fn read_stored(path: &Path, id: &str) -> Result<StoredIso, String> {
    let metadata_path = path.join(METADATA_FILE);
    let info = regular_file_info(&metadata_path)?;
    if info.len() > MAX_METADATA_BYTES {
        return Err("ISO の管理情報が大きすぎます。".into());
    }
    let bytes =
        fs::read(&metadata_path).map_err(|error| io_error("ISO の管理情報を読めません", error))?;
    let stored: StoredIso = serde_json::from_slice(&bytes)
        .map_err(|error| format!("ISO の管理情報が壊れています: {error}"))?;
    if stored.id != id || stored.name.trim().is_empty() || stored.file_name.is_empty() {
        return Err("ISO の管理情報が一致しません。".into());
    }
    Ok(stored)
}

fn image_available(dir: &Path, expected_size: u64) -> bool {
    let image_path = dir.join(IMAGE_FILE);
    if !regular_file_info(&image_path).is_ok_and(|info| info.len() == expected_size) {
        return false;
    }
    File::open(image_path)
        .ok()
        .and_then(|mut file| has_volume_marker(&mut file).ok())
        .unwrap_or(false)
}

pub fn list(root: &Path) -> Result<IsoLibrary, String> {
    let canonical_root = ensure_root(root)?;
    let mut images = Vec::new();
    let entries =
        fs::read_dir(&canonical_root).map_err(|error| io_error("ISO 一覧を読めません", error))?;
    for entry in entries {
        let entry = entry.map_err(|error| io_error("ISO 一覧を読めません", error))?;
        let id = entry.file_name().to_string_lossy().into_owned();
        if !valid_id(&id) {
            continue;
        }
        let Ok(dir) = checked_item_dir(&canonical_root, &id) else {
            continue;
        };
        let Ok(stored) = read_stored(&dir, &id) else {
            continue;
        };
        let available = image_available(&dir, stored.size_bytes);
        images.push(stored.into_image(available));
    }
    images.sort_by(|a, b| {
        b.imported_at
            .cmp(&a.imported_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(IsoLibrary {
        directory: root.to_string_lossy().into_owned(),
        images,
    })
}

pub fn import<F>(
    root: &Path,
    request: ImportIsoRequest,
    mut progress_callback: F,
) -> Result<IsoImage, String>
where
    F: FnMut(IsoImportProgress) -> Result<(), String>,
{
    let canonical_root = ensure_root(root)?;
    let source_path = Path::new(&request.source_path);
    if !source_path.is_absolute() {
        return Err("ISO ファイルの絶対パスを指定してください。".into());
    }
    if !source_path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("iso"))
    {
        return Err(".iso ファイルを選択してください。".into());
    }
    regular_file_info(source_path)?;
    let canonical_source = fs::canonicalize(source_path)
        .map_err(|error| io_error("元の ISO を確認できません", error))?;
    if canonical_source.starts_with(&canonical_root) {
        return Err("ライブラリ内の ISO は再取り込みできません。".into());
    }
    let name = request.name.trim();
    if name.is_empty() || name.chars().count() > 120 || name.chars().any(char::is_control) {
        return Err("ISO 名は制御文字を含まない 1〜120 文字で入力してください。".into());
    }
    let file_name = source_path
        .file_name()
        .ok_or_else(|| "ISO のファイル名を取得できません。".to_string())?
        .to_string_lossy()
        .into_owned();

    let mut source =
        File::open(&canonical_source).map_err(|error| io_error("元の ISO を開けません", error))?;
    let total_bytes = source
        .metadata()
        .map_err(|error| io_error("元の ISO を確認できません", error))?
        .len();
    if total_bytes < 17 * 2048 || !has_volume_marker(&mut source)? {
        return Err("ISO9660 または UDF のボリューム情報を確認できません。".into());
    }
    progress_callback(IsoImportProgress {
        copied_bytes: 0,
        total_bytes,
    })?;

    let (id, staging_path, final_path) = (0..10)
        .find_map(|_| {
            let id = Uuid::new_v4().simple().to_string();
            let staging_path = canonical_root.join(format!(".{id}.partial"));
            let final_path = canonical_root.join(&id);
            if final_path.exists() {
                return None;
            }
            match fs::create_dir(&staging_path) {
                Ok(()) => Some(Ok((id, staging_path, final_path))),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => None,
                Err(error) => Some(Err(io_error("ISO の一時保存先を作成できません", error))),
            }
        })
        .ok_or_else(|| "ISO ID を確保できません。".to_string())??;
    let mut staging = StagingDirectory {
        root: canonical_root,
        path: staging_path,
        committed: false,
    };
    let destination_path = staging.path.join(IMAGE_FILE);
    let mut destination = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&destination_path)
        .map_err(|error| io_error("ISO コピー先を開けません", error))?;

    let mut copied_bytes = 0u64;
    let mut last_progress_bytes = 0u64;
    let mut buffer = vec![0u8; COPY_BUFFER_SIZE];
    loop {
        let read = source
            .read(&mut buffer)
            .map_err(|error| io_error("元の ISO を読めません", error))?;
        if read == 0 {
            break;
        }
        if copied_bytes.saturating_add(read as u64) > total_bytes {
            return Err("コピー中に元の ISO のサイズが変わりました。".into());
        }
        destination
            .write_all(&buffer[..read])
            .map_err(|error| io_error("ISO をコピーできません", error))?;
        copied_bytes += read as u64;
        if last_progress_bytes == 0
            || copied_bytes.saturating_sub(last_progress_bytes) >= PROGRESS_INTERVAL
        {
            progress_callback(IsoImportProgress {
                copied_bytes,
                total_bytes,
            })?;
            last_progress_bytes = copied_bytes;
        }
    }
    if copied_bytes != total_bytes
        || source
            .metadata()
            .map_err(|error| io_error("元の ISO を確認できません", error))?
            .len()
            != total_bytes
    {
        return Err("コピー中に元の ISO のサイズが変わりました。".into());
    }
    destination
        .sync_all()
        .map_err(|error| io_error("コピーした ISO を保存できません", error))?;
    drop(destination);

    let stored = StoredIso {
        id: id.clone(),
        name: name.to_string(),
        os_family: request.os_family,
        file_name,
        size_bytes: total_bytes,
        imported_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("取り込み時刻を取得できません: {error}"))?
            .as_secs(),
    };
    let metadata_path = staging.path.join(METADATA_FILE);
    let mut metadata = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&metadata_path)
        .map_err(|error| io_error("ISO の管理情報を作成できません", error))?;
    serde_json::to_writer(&mut metadata, &stored)
        .map_err(|error| format!("ISO の管理情報を書けません: {error}"))?;
    metadata
        .sync_all()
        .map_err(|error| io_error("ISO の管理情報を保存できません", error))?;
    drop(metadata);
    if final_path.exists() {
        return Err("ISO ID が重複しました。もう一度お試しください。".into());
    }
    fs::rename(&staging.path, &final_path)
        .map_err(|error| io_error("ISO を確定できません", error))?;
    staging.committed = true;
    if last_progress_bytes != total_bytes {
        // The copy is already committed. A disconnected UI must not turn a
        // successful import into an error or cause a retry to duplicate it.
        let _ = progress_callback(IsoImportProgress {
            copied_bytes: total_bytes,
            total_bytes,
        });
    }
    Ok(stored.into_image(true))
}

pub fn resolve(root: &Path, id: &str) -> Result<(PathBuf, OsFamily), String> {
    let canonical_root = ensure_root(root)?;
    let dir = checked_item_dir(&canonical_root, id)?;
    let stored = read_stored(&dir, id)?;
    if !image_available(&dir, stored.size_bytes) {
        return Err("ISO ファイルが見つからないか、内容が変わっています。".into());
    }
    Ok((dir.join(IMAGE_FILE), stored.os_family))
}

pub fn remove(root: &Path, id: &str) -> Result<(), String> {
    let canonical_root = ensure_root(root)?;
    let dir = checked_item_dir(&canonical_root, id)?;
    let _stored = read_stored(&dir, id)?;
    for entry in fs::read_dir(&dir).map_err(|error| io_error("ISO 保存先を読めません", error))?
    {
        let entry = entry.map_err(|error| io_error("ISO 保存先を読めません", error))?;
        if entry.file_name() != IMAGE_FILE && entry.file_name() != METADATA_FILE {
            return Err("ISO 保存先に予期しないファイルがあるため削除できません。".into());
        }
    }
    let image_path = dir.join(IMAGE_FILE);
    match fs::symlink_metadata(&image_path) {
        Ok(info) if info.is_file() || info.file_type().is_symlink() => {
            // Delete the ISO first. On Windows, an open image can reject this
            // operation; its metadata must remain so the user can retry.
            fs::remove_file(&image_path)
                .map_err(|error| io_error("使用中の ISO を削除できません", error))?;
        }
        Ok(_) => return Err("ISO ファイルの形式が正しくありません。".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(io_error("ISO ファイルを確認できません", error)),
    }
    fs::remove_file(dir.join(METADATA_FILE))
        .map_err(|error| io_error("ISO の管理情報を削除できません", error))?;
    fs::remove_dir(&dir).map_err(|error| io_error("ISO 保存フォルダーを削除できません", error))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        root: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("hyperv-studio-iso-test-{}", Uuid::new_v4()));
            fs::create_dir(&root).unwrap();
            Self { root }
        }

        fn iso(&self, name: &str, size: usize) -> PathBuf {
            let path = self.root.join(name);
            let mut file = File::create(&path).unwrap();
            file.set_len(size as u64).unwrap();
            file.seek(SeekFrom::Start(16 * 2048)).unwrap();
            file.write_all(b"\x01CD001").unwrap();
            path
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn import_preserves_source_and_remove_only_deletes_managed_copy() {
        let fixture = Fixture::new();
        let source = fixture.iso("install.iso", 70_000);
        let library_root = fixture.root.join("library");
        let request = ImportIsoRequest {
            source_path: source.to_string_lossy().into_owned(),
            name: "Linux installer".into(),
            os_family: OsFamily::Linux,
        };
        let image = import(&library_root, request, |_| Ok(())).unwrap();
        let catalog = list(&library_root).unwrap();
        assert_eq!(catalog.images.len(), 1);
        assert!(catalog.images[0].available);
        assert_eq!(catalog.images[0].file_name, "install.iso");
        let (managed_path, family) = resolve(&library_root, &image.id).unwrap();
        assert_eq!(family, OsFamily::Linux);
        assert_eq!(fs::read(&source).unwrap(), fs::read(&managed_path).unwrap());
        remove(&library_root, &image.id).unwrap();
        assert!(source.exists());
        assert!(list(&library_root).unwrap().images.is_empty());
    }

    #[test]
    fn rejects_fake_iso_and_paths_inside_managed_library() {
        let fixture = Fixture::new();
        let library_root = fixture.root.join("library");
        let fake = fixture.root.join("fake.iso");
        fs::write(&fake, vec![0u8; 70_000]).unwrap();
        let request = |path: &Path| ImportIsoRequest {
            source_path: path.to_string_lossy().into_owned(),
            name: "Test".into(),
            os_family: OsFamily::Other,
        };
        assert!(import(&library_root, request(&fake), |_| Ok(())).is_err());
        assert!(list(&library_root).unwrap().images.is_empty());

        let source = fixture.iso("real.iso", 70_000);
        let first = import(&library_root, request(&source), |_| Ok(())).unwrap();
        let managed = resolve(&library_root, &first.id).unwrap().0;
        assert!(import(&library_root, request(&managed), |_| Ok(())).is_err());
        assert!(resolve(&library_root, "../escape").is_err());
        assert!(remove(&library_root, "../escape").is_err());
    }

    #[test]
    fn progress_failure_leaves_no_listed_or_partial_import() {
        let fixture = Fixture::new();
        let source = fixture.iso("large.iso", 9 * 1024 * 1024);
        let library_root = fixture.root.join("library");
        let request = ImportIsoRequest {
            source_path: source.to_string_lossy().into_owned(),
            name: "Interrupted".into(),
            os_family: OsFamily::Linux,
        };
        let result = import(&library_root, request, |progress| {
            if progress.copied_bytes > 0 {
                Err("cancelled".into())
            } else {
                Ok(())
            }
        });
        assert!(result.is_err());
        assert!(source.exists());
        assert!(list(&library_root).unwrap().images.is_empty());
        assert_eq!(fs::read_dir(&library_root).unwrap().count(), 0);
    }

    #[test]
    fn missing_managed_file_is_visible_but_cannot_be_resolved() {
        let fixture = Fixture::new();
        let source = fixture.iso("install.iso", 70_000);
        let library_root = fixture.root.join("library");
        let request = ImportIsoRequest {
            source_path: source.to_string_lossy().into_owned(),
            name: "Unavailable".into(),
            os_family: OsFamily::Windows,
        };
        let image = import(&library_root, request, |_| Ok(())).unwrap();
        let managed = resolve(&library_root, &image.id).unwrap().0;
        fs::remove_file(managed).unwrap();
        assert!(!list(&library_root).unwrap().images[0].available);
        assert!(resolve(&library_root, &image.id).is_err());
        remove(&library_root, &image.id).unwrap();
        assert!(source.exists());
    }
}
