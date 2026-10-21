use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const BLOCK_SIZE: usize = 2048;
const PRIMARY_ROOT: u32 = 23;
const JOLIET_ROOT: u32 = 24;
const FILE_START: u32 = 25;
const IMAGE_FILE: &str = "seed.iso";
const MAX_ADAPTERS: usize = 8;

pub struct PreparedSeed {
    pub iso_path: PathBuf,
    pub macs: Vec<String>,
}

struct SeedFile {
    primary_name: &'static str,
    name: &'static str,
    contents: Vec<u8>,
    extent: u32,
}

struct PendingSeed {
    root: PathBuf,
    path: PathBuf,
    committed: bool,
}

impl Drop for PendingSeed {
    fn drop(&mut self) {
        if self.committed {
            return;
        }
        let safe = fs::symlink_metadata(&self.path)
            .ok()
            .is_some_and(|info| info.is_dir() && !is_link(&info))
            && fs::canonicalize(&self.path)
                .ok()
                .is_some_and(|path| path.parent() == Some(self.root.as_path()));
        if safe {
            // This directory only contains our one known file. Never recursively
            // delete a path that another process could have replaced.
            let _ = fs::remove_file(self.path.join(IMAGE_FILE));
            let _ = fs::remove_dir(&self.path);
        }
    }
}

fn is_link(info: &fs::Metadata) -> bool {
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

fn io_error(message: &str, error: std::io::Error) -> String {
    format!("{message}: {error}")
}

fn validate_hostname(hostname: &str) -> Result<(), String> {
    let bytes = hostname.as_bytes();
    if bytes.is_empty()
        || bytes.len() > 63
        || !bytes[0].is_ascii_alphanumeric()
        || !bytes[bytes.len() - 1].is_ascii_alphanumeric()
        || !bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
    {
        return Err(
            "OS のホスト名は 1〜63 文字の半角小文字・数字・ハイフンで入力してください。先頭と末尾は英数字にしてください。"
                .into(),
        );
    }
    Ok(())
}

/// Create a local NoCloud seed for one clone. The caller must assign `macs` in
/// adapter order, check host-wide MAC uniqueness and copy this ISO into the
/// clone's permanent directory before attaching it. An empty adapter list
/// explicitly disables fallback DHCP configuration.
pub fn prepare(root: &Path, hostname: &str, adapter_count: usize) -> Result<PreparedSeed, String> {
    validate_hostname(hostname)?;
    if adapter_count > MAX_ADAPTERS {
        return Err("OS 自動設定のネットワークアダプター数は 0〜8 個にしてください。".into());
    }
    if !root.is_absolute() {
        return Err("初期設定 ISO の保存先は絶対パスで指定してください。".into());
    }
    fs::create_dir_all(root)
        .map_err(|error| io_error("初期設定 ISO の保存先を作成できません", error))?;
    let info = fs::symlink_metadata(root)
        .map_err(|error| io_error("初期設定 ISO の保存先を確認できません", error))?;
    if !info.is_dir() || is_link(&info) {
        return Err("初期設定 ISO の保存先が通常のフォルダーではありません。".into());
    }
    let root = fs::canonicalize(root)
        .map_err(|error| io_error("初期設定 ISO の保存先を確認できません", error))?;
    let id = Uuid::new_v4().simple().to_string();
    // 02 marks a locally administered, unicast Ethernet address. Keep DHCP
    // independent of this fixed hardware address so seed matching is stable.
    let mut macs = Vec::with_capacity(adapter_count);
    while macs.len() < adapter_count {
        let mac_id = Uuid::new_v4().simple().to_string();
        let mac = format!("02{}", &mac_id[..10]);
        if !macs.contains(&mac) {
            macs.push(mac);
        }
    }
    let files = seed_files(&id, hostname, &macs);
    let image = build_iso(files)?;
    let destination = root.join(&id);
    let staging = root.join(format!(".{id}.partial"));
    if destination
        .try_exists()
        .map_err(|error| io_error("初期設定 ISO の保存先を確認できません", error))?
    {
        return Err("初期設定 ISO の保存先が既に存在します。もう一度実行してください。".into());
    }
    fs::create_dir(&staging)
        .map_err(|error| io_error("初期設定 ISO の作業フォルダーを作成できません", error))?;
    let mut pending = PendingSeed {
        root,
        path: staging.clone(),
        committed: false,
    };
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(staging.join(IMAGE_FILE))
        .map_err(|error| io_error("初期設定 ISO を作成できません", error))?;
    output
        .write_all(&image)
        .and_then(|()| output.sync_all())
        .map_err(|error| io_error("初期設定 ISO を保存できません", error))?;
    drop(output);
    fs::rename(&staging, &destination)
        .map_err(|error| io_error("初期設定 ISO の保存を確定できません", error))?;
    pending.committed = true;
    Ok(PreparedSeed {
        iso_path: destination.join(IMAGE_FILE),
        macs,
    })
}

fn seed_files(id: &str, hostname: &str, macs: &[String]) -> Vec<SeedFile> {
    // Module selection in the prepared template excludes users-groups and
    // set-passwords. No credentials or new users are supplied by this seed.
    let user_data = format!(
        "#cloud-config\nhostname: {hostname}\npreserve_hostname: false\nmanage_etc_hosts: localhost\nusers: []\ndisable_root: false\nallow_public_ssh_keys: false\nssh_deletekeys: true\nssh_genkeytypes: [rsa, ecdsa, ed25519]\n"
    );
    let meta_data = format!("instance-id: hyperv-studio-{id}\nlocal-hostname: {hostname}\n");
    let mut network_config = if macs.is_empty() {
        "version: 1\nconfig: []\n".to_string()
    } else {
        "version: 1\nconfig:\n".to_string()
    };
    for (index, mac) in macs.iter().enumerate() {
        let colon_mac = mac
            .as_bytes()
            .chunks_exact(2)
            .map(|pair| String::from_utf8_lossy(pair))
            .collect::<Vec<_>>()
            .join(":");
        let metric = (index + 1) * 100;
        // Give each DHCP interface a different route metric. The template's
        // NetworkManager defaults also cover older cloud-init renderers which
        // did not pass subnet metrics through to NetworkManager keyfiles.
        network_config.push_str(&format!(
            "  - type: physical\n    name: eth{index}\n    mac_address: \"{colon_mac}\"\n    subnets:\n      - type: dhcp4\n        metric: {metric}\n"
        ));
    }
    // Keep directory entries in lexical order in both namespaces. ISO9660 has
    // compliant 8.3 aliases; Joliet exposes the exact NoCloud file names.
    vec![
        SeedFile {
            primary_name: "META_DAT.;1",
            name: "meta-data",
            contents: meta_data.into_bytes(),
            extent: 0,
        },
        SeedFile {
            primary_name: "NETWORK_.;1",
            name: "network-config",
            contents: network_config.into_bytes(),
            extent: 0,
        },
        SeedFile {
            primary_name: "USER_DAT.;1",
            name: "user-data",
            contents: user_data.into_bytes(),
            extent: 0,
        },
    ]
}

fn both_u16(bytes: &mut [u8], offset: usize, value: u16) {
    bytes[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
    bytes[offset + 2..offset + 4].copy_from_slice(&value.to_be_bytes());
}

fn both_u32(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    bytes[offset + 4..offset + 8].copy_from_slice(&value.to_be_bytes());
}

fn unicode(value: &str) -> Vec<u8> {
    value.encode_utf16().flat_map(u16::to_be_bytes).collect()
}

fn text_field(bytes: &mut [u8], offset: usize, length: usize, text: &str, joliet: bool) {
    let field = &mut bytes[offset..offset + length];
    let value = if joliet {
        field.fill(0);
        unicode(text)
    } else {
        field.fill(b' ');
        text.as_bytes().to_vec()
    };
    field[..value.len()].copy_from_slice(&value);
}

fn directory_record(extent: u32, length: u32, name: &[u8], directory: bool) -> Vec<u8> {
    let record_length = (33 + name.len() + 1) & !1;
    let mut record = vec![0u8; record_length];
    record[0] = record_length as u8;
    both_u32(&mut record, 2, extent);
    both_u32(&mut record, 10, length);
    record[18..25].copy_from_slice(&[126, 1, 1, 0, 0, 0, 0]);
    record[25] = if directory { 2 } else { 0 };
    both_u16(&mut record, 28, 1);
    record[32] = name.len() as u8;
    record[33..33 + name.len()].copy_from_slice(name);
    record
}

fn volume_descriptor(total_blocks: u32, joliet: bool) -> Vec<u8> {
    let mut descriptor = vec![0u8; BLOCK_SIZE];
    descriptor[0] = if joliet { 2 } else { 1 };
    descriptor[1..6].copy_from_slice(b"CD001");
    descriptor[6] = 1;
    text_field(&mut descriptor, 8, 32, "HYPERV_STUDIO", joliet);
    text_field(&mut descriptor, 40, 32, "CIDATA", joliet);
    both_u32(&mut descriptor, 80, total_blocks);
    if joliet {
        descriptor[88..91].copy_from_slice(b"%/E");
    }
    both_u16(&mut descriptor, 120, 1);
    both_u16(&mut descriptor, 124, 1);
    both_u16(&mut descriptor, 128, BLOCK_SIZE as u16);
    both_u32(&mut descriptor, 132, 10);
    let (little_table, big_table, root) = if joliet {
        (21u32, 22u32, JOLIET_ROOT)
    } else {
        (19u32, 20u32, PRIMARY_ROOT)
    };
    descriptor[140..144].copy_from_slice(&little_table.to_le_bytes());
    descriptor[148..152].copy_from_slice(&big_table.to_be_bytes());
    descriptor[156..190].copy_from_slice(&directory_record(root, BLOCK_SIZE as u32, &[0], true));
    text_field(&mut descriptor, 190, 128, "CIDATA", joliet);
    text_field(&mut descriptor, 318, 128, "", joliet);
    text_field(&mut descriptor, 446, 128, "HYPERV_STUDIO", joliet);
    text_field(&mut descriptor, 574, 128, "HYPERV_STUDIO", joliet);
    // Joliet uses zero padding in its UCS-2 fields. No copyright, abstract or
    // bibliographic file is present in either directory hierarchy.
    descriptor[702..813].fill(if joliet { 0 } else { b' ' });
    for offset in [813usize, 830, 847, 864] {
        descriptor[offset..offset + 16].fill(b'0');
    }
    descriptor[813..829].copy_from_slice(b"2026010100000000");
    descriptor[830..846].copy_from_slice(b"2026010100000000");
    descriptor[864..880].copy_from_slice(b"2026010100000000");
    descriptor[881] = 1;
    descriptor
}

fn path_table(root: u32, big_endian: bool) -> Vec<u8> {
    let mut table = vec![0u8; BLOCK_SIZE];
    table[0] = 1;
    if big_endian {
        table[2..6].copy_from_slice(&root.to_be_bytes());
        table[6..8].copy_from_slice(&1u16.to_be_bytes());
    } else {
        table[2..6].copy_from_slice(&root.to_le_bytes());
        table[6..8].copy_from_slice(&1u16.to_le_bytes());
    }
    table
}

fn root_directory(files: &[SeedFile], joliet: bool) -> Result<Vec<u8>, String> {
    let extent = if joliet { JOLIET_ROOT } else { PRIMARY_ROOT };
    let mut directory = directory_record(extent, BLOCK_SIZE as u32, &[0], true);
    directory.extend(directory_record(extent, BLOCK_SIZE as u32, &[1], true));
    for file in files {
        let name = if joliet {
            unicode(file.name)
        } else {
            file.primary_name.as_bytes().to_vec()
        };
        directory.extend(directory_record(
            file.extent,
            file.contents.len() as u32,
            &name,
            false,
        ));
    }
    if directory.len() > BLOCK_SIZE {
        return Err("初期設定 ISO のディレクトリーが大きすぎます。".into());
    }
    directory.resize(BLOCK_SIZE, 0);
    Ok(directory)
}

/// A deliberately restricted ISO9660 level-1 + Joliet filesystem: one root,
/// three small regular files, 2048-byte sectors and no boot catalog. Both
/// namespace indexes reference the same file data, as specified by Joliet.
fn build_iso(mut files: Vec<SeedFile>) -> Result<Vec<u8>, String> {
    let mut next_block = FILE_START;
    for file in &mut files {
        if file.contents.len() > BLOCK_SIZE {
            return Err("初期設定 ISO に保存するファイルが大きすぎます。".into());
        }
        file.extent = next_block;
        next_block += 1;
    }
    let mut image = vec![0u8; next_block as usize * BLOCK_SIZE];
    let blocks = [
        (16, volume_descriptor(next_block, false)),
        (17, volume_descriptor(next_block, true)),
        (19, path_table(PRIMARY_ROOT, false)),
        (20, path_table(PRIMARY_ROOT, true)),
        (21, path_table(JOLIET_ROOT, false)),
        (22, path_table(JOLIET_ROOT, true)),
        (PRIMARY_ROOT, root_directory(&files, false)?),
        (JOLIET_ROOT, root_directory(&files, true)?),
    ];
    for (block, bytes) in blocks {
        let start = block as usize * BLOCK_SIZE;
        image[start..start + BLOCK_SIZE].copy_from_slice(&bytes);
    }
    let terminator = 18 * BLOCK_SIZE;
    image[terminator] = 255;
    image[terminator + 1..terminator + 6].copy_from_slice(b"CD001");
    image[terminator + 6] = 1;
    for file in files {
        let start = file.extent as usize * BLOCK_SIZE;
        image[start..start + file.contents.len()].copy_from_slice(&file.contents);
    }
    Ok(image)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn read_u32(bytes: &[u8], offset: usize) -> u32 {
        u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
    }

    fn extract_joliet(image: &[u8]) -> BTreeMap<String, String> {
        let descriptor = &image[17 * BLOCK_SIZE..18 * BLOCK_SIZE];
        assert_eq!(&descriptor[..7], b"\x02CD001\x01");
        assert_eq!(&descriptor[88..91], b"%/E");
        let extent = read_u32(descriptor, 158) as usize * BLOCK_SIZE;
        let length = read_u32(descriptor, 166) as usize;
        let mut position = extent;
        let mut result = BTreeMap::new();
        while position < extent + length && image[position] != 0 {
            let record = &image[position..position + image[position] as usize];
            assert_eq!(
                read_u32(record, 2),
                u32::from_be_bytes(record[6..10].try_into().unwrap())
            );
            if record[25] & 2 == 0 {
                let name_bytes = &record[33..33 + record[32] as usize];
                let name = String::from_utf16(
                    &name_bytes
                        .chunks_exact(2)
                        .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
                        .collect::<Vec<_>>(),
                )
                .unwrap();
                let start = read_u32(record, 2) as usize * BLOCK_SIZE;
                let end = start + read_u32(record, 10) as usize;
                assert!(result
                    .insert(name, String::from_utf8(image[start..end].to_vec()).unwrap())
                    .is_none());
            }
            position += record.len();
        }
        result
    }

    #[test]
    fn rejects_hostname_injection_before_touching_storage() {
        let root = std::env::temp_dir().join(format!("hyperv-seed-{}", Uuid::new_v4()));
        for hostname in [
            "",
            "A",
            "a_b",
            "-a",
            "a-",
            "a.b",
            "a\nusers: [root]",
            "日本語",
        ] {
            assert!(prepare(&root, hostname, 1).is_err());
        }
        assert!(prepare(&root, &"a".repeat(64), 1).is_err());
        assert!(!root.exists());
        assert!(validate_hostname("rhel10-copy-01").is_ok());
        assert!(validate_hostname(&"a".repeat(63)).is_ok());
    }

    #[test]
    fn iso_has_joliet_nocloud_files_and_matching_mac() {
        let image = build_iso(seed_files(
            "00112233445566778899aabbccddeeff",
            "alma-copy-01",
            &["020011223344".to_string()],
        ))
        .unwrap();
        assert_eq!(image.len() % BLOCK_SIZE, 0);
        assert_eq!(
            &image[16 * BLOCK_SIZE..16 * BLOCK_SIZE + 7],
            b"\x01CD001\x01"
        );
        assert_eq!(
            &image[16 * BLOCK_SIZE + 40..16 * BLOCK_SIZE + 46],
            b"CIDATA"
        );
        let files = extract_joliet(&image);
        assert_eq!(
            files.keys().map(String::as_str).collect::<Vec<_>>(),
            vec!["meta-data", "network-config", "user-data"]
        );
        assert!(files["meta-data"].contains("local-hostname: alma-copy-01\n"));
        assert!(files["network-config"].contains("mac_address: \"02:00:11:22:33:44\""));
        assert!(files["network-config"].contains("type: dhcp4\n"));
        assert!(files["user-data"].starts_with("#cloud-config\n"));
        assert!(!files["user-data"].contains("ssh_pwauth:"));
        assert!(!files["user-data"].contains("password:"));
    }

    #[test]
    fn commits_unique_complete_seed_directories() {
        let root = std::env::temp_dir().join(format!("hyperv-seed-{}", Uuid::new_v4()));
        let first = prepare(&root, "rocky-a", 2).unwrap();
        let second = prepare(&root, "rocky-b", MAX_ADAPTERS).unwrap();
        let all_macs = first.macs.iter().chain(&second.macs).collect::<Vec<_>>();
        assert_eq!(all_macs.len(), 10);
        assert_eq!(
            all_macs
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            all_macs.len()
        );
        assert_ne!(first.iso_path, second.iso_path);
        for mac in all_macs {
            assert!(mac.starts_with("02"));
            assert_eq!(mac.len(), 12);
            assert!(mac.bytes().all(|byte| byte.is_ascii_hexdigit()));
        }
        let entries = fs::read_dir(&root)
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(entries.len(), 2);
        for entry in &entries {
            let name = entry.file_name();
            let name = name.to_str().unwrap();
            assert_eq!(name.len(), 32);
            assert!(name.bytes().all(|byte| byte.is_ascii_hexdigit()));
        }
        for seed in [first, second] {
            let files = extract_joliet(&fs::read(&seed.iso_path).unwrap());
            assert_eq!(files.len(), 3);
            assert_eq!(
                files["network-config"]
                    .matches("  - type: physical\n")
                    .count(),
                seed.macs.len()
            );
            assert!(files["network-config"].len() <= BLOCK_SIZE);
            if seed.macs.len() == MAX_ADAPTERS {
                assert!(files["network-config"].contains("    name: eth7\n"));
                assert!(files["network-config"].contains("        metric: 800\n"));
            }
            fs::remove_file(&seed.iso_path).unwrap();
            fs::remove_dir(seed.iso_path.parent().unwrap()).unwrap();
        }
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn rejects_excess_adapters_before_touching_storage() {
        let root = std::env::temp_dir().join(format!("hyperv-seed-{}", Uuid::new_v4()));
        for adapter_count in [MAX_ADAPTERS + 1, usize::MAX] {
            assert!(prepare(&root, "alma-test", adapter_count).is_err());
        }
        assert!(!root.exists());
    }

    #[test]
    fn configures_each_mac_with_dhcp_and_distinct_route_preference() {
        let macs = ["020011223344", "02aabbccddee", "020102030405"].map(str::to_string);
        let files =
            extract_joliet(&build_iso(seed_files("0123456789abcdef", "rhel-many", &macs)).unwrap());
        let network = &files["network-config"];
        assert_eq!(
            network,
            "version: 1\nconfig:\n  - type: physical\n    name: eth0\n    mac_address: \"02:00:11:22:33:44\"\n    subnets:\n      - type: dhcp4\n        metric: 100\n  - type: physical\n    name: eth1\n    mac_address: \"02:aa:bb:cc:dd:ee\"\n    subnets:\n      - type: dhcp4\n        metric: 200\n  - type: physical\n    name: eth2\n    mac_address: \"02:01:02:03:04:05\"\n    subnets:\n      - type: dhcp4\n        metric: 300\n"
        );
        assert!(!network.contains("gateway:"));
        assert!(!network.contains("bridge"));
    }

    #[test]
    fn zero_adapters_writes_explicit_empty_network_configuration() {
        let files = extract_joliet(
            &build_iso(seed_files("0123456789abcdef", "alma-offline", &[])).unwrap(),
        );
        assert_eq!(files["network-config"], "version: 1\nconfig: []\n");
        assert!(files["user-data"].contains("hostname: alma-offline\n"));
    }

    #[test]
    #[ignore = "Writes a temporary ISO for verification with an independent reader"]
    fn write_external_reader_fixture() {
        let root = std::env::temp_dir().join(format!("hyperv-seed-fixture-{}", Uuid::new_v4()));
        let seed = prepare(&root, "alma-clone-qa", 3).unwrap();
        println!("seed_iso={}", seed.iso_path.display());
        println!("seed_macs={}", seed.macs.join(","));
    }
}
