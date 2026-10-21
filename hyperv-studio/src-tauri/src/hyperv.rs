use crate::iso_library::OsFamily;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::json;
use std::process::Command;

#[derive(Debug, Deserialize, Serialize)]
pub struct RenameVmRequest {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct DeleteVmRequest {
    pub id: String,
    pub expected_name: String,
    pub confirmation_name: String,
    pub delete_disks: bool,
    pub expected_disk_paths: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct VmDeleteInfo {
    pub id: String,
    pub name: String,
    pub state: String,
    pub disk_paths: Vec<String>,
    pub can_delete_disks: bool,
    pub disk_delete_reason: Option<String>,
    pub has_checkpoints: bool,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct DeleteVmResult {
    pub id: String,
    pub deleted_disk_paths: Vec<String>,
    pub retained_disk_paths: Vec<String>,
    pub warning: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CloneVmRequest {
    pub source_id: String,
    pub name: String,
    #[serde(default)]
    pub connect_network: bool,
    pub guest_hostname: Option<String>,
    #[serde(skip_deserializing)]
    pub guest_seed_path: Option<String>,
    #[serde(skip_deserializing, default)]
    pub guest_macs: Vec<String>,
    #[serde(skip_deserializing, default)]
    pub guest_adapter_ids: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct VmNetworkAdapter {
    pub id: String,
    pub name: String,
    pub switch_name: Option<String>,
    pub mac_address: String,
    pub is_legacy: bool,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct NetworkAdapterRequest {
    pub id: Option<String>,
    pub switch_name: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SaveVmNetworkAdaptersRequest {
    pub vm_id: String,
    pub expected_adapter_ids: Vec<String>,
    pub adapters: Vec<NetworkAdapterRequest>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct VmBootEntry {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub detail: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct VmBootSettings {
    pub vm_id: String,
    pub name: String,
    pub state: String,
    pub generation: u8,
    pub secure_boot_enabled: Option<bool>,
    pub secure_boot_template: Option<String>,
    pub boot_entries: Vec<VmBootEntry>,
    pub revision: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SaveVmBootSettingsRequest {
    pub vm_id: String,
    pub expected_revision: String,
    pub secure_boot_enabled: Option<bool>,
    pub boot_order: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CloneProgress {
    pub phase: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum CloneEvent {
    Progress { progress: CloneProgress },
    Result { value: VmInfo },
}

fn read_clone_events<R, F>(reader: R, on_progress: &mut F) -> Result<VmInfo, String>
where
    R: std::io::BufRead,
    F: FnMut(CloneProgress),
{
    let mut result = None;
    let mut protocol_error = None;
    for line in reader.lines() {
        let event = line
            .map_err(|err| format!("複製の進捗を読み取れません: {err}"))
            .and_then(|line| {
                serde_json::from_str::<CloneEvent>(line.trim().trim_start_matches('\u{feff}'))
                    .map_err(|err| format!("複製の応答を読み取れません: {err}"))
            });
        match event {
            Ok(CloneEvent::Progress { progress }) => on_progress(progress),
            Ok(CloneEvent::Result { value }) => {
                if result.replace(value).is_some() {
                    protocol_error = Some("複製の応答が重複しています。".to_string());
                }
            }
            Err(err) => {
                protocol_error.get_or_insert(err);
            }
        }
    }
    // Always drain the pipe before reporting protocol errors; the child may still
    // be finishing cleanup and must not block on stdout or be abandoned midway.
    if let Some(err) = protocol_error {
        return Err(err);
    }
    result.ok_or_else(|| "複製処理から結果が返されませんでした。".into())
}

#[derive(Debug, Deserialize, Serialize)]
pub struct HostStatus {
    pub computer_name: String,
    pub can_manage: bool,
    pub error: Option<String>,
    pub default_vm_path: Option<String>,
    pub default_vhd_path: Option<String>,
    pub switches: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct VmInfo {
    pub id: String,
    pub name: String,
    pub state: String,
    pub generation: u8,
    pub memory_startup_bytes: u64,
    pub memory_assigned_bytes: u64,
    pub processor_count: u32,
    pub uptime_seconds: u64,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CreateVmRequest {
    pub name: String,
    #[serde(default = "default_vm_generation")]
    pub generation: u8,
    #[serde(default = "default_vm_memory_mb")]
    pub memory_startup_mb: u32,
    #[serde(default = "default_vm_disk_gb")]
    pub vhd_size_gb: u32,
    pub cpu_count: u32,
    pub switch_name: Option<String>,
    pub network_adapters: Option<Vec<NetworkAdapterRequest>>,
    pub iso_path: Option<String>,
    pub iso_id: Option<String>,
    #[serde(skip_deserializing, rename = "os_family")]
    pub iso_os_family: Option<OsFamily>,
}

fn default_vm_generation() -> u8 {
    2
}

fn default_vm_memory_mb() -> u32 {
    8192
}

fn default_vm_disk_gb() -> u32 {
    200
}

const SCRIPT: &str = include_str!("../scripts/hyperv.ps1");

#[cfg(windows)]
fn windows_system_directory() -> Result<std::path::PathBuf, String> {
    use std::os::windows::ffi::OsStringExt;

    let mut system_directory = [0u16; 32768];
    let length = unsafe {
        windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW(
            system_directory.as_mut_ptr(),
            system_directory.len() as u32,
        )
    } as usize;
    if length == 0 || length >= system_directory.len() {
        return Err("Windows のシステムディレクトリを取得できません。".into());
    }
    Ok(std::path::PathBuf::from(std::ffi::OsString::from_wide(
        &system_directory[..length],
    )))
}

#[cfg(windows)]
fn powershell_command(action: &str, payload: serde_json::Value) -> Result<Command, String> {
    use std::os::windows::process::CommandExt;

    let powershell = windows_system_directory()?
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
    let mut command = Command::new(powershell);
    command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false); & ([ScriptBlock]::Create([Console]::In.ReadToEnd()))",
        ])
        .env("HYPERV_STUDIO_ACTION", action)
        .env("HYPERV_STUDIO_PAYLOAD", payload.to_string())
        .env_remove("PSModulePath")
        .creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    Ok(command)
}

#[cfg(windows)]
fn spawn_powershell(
    action: &str,
    payload: serde_json::Value,
) -> Result<std::process::Child, String> {
    use std::io::Write;
    use std::process::Stdio;

    let mut child = powershell_command(action, payload)?
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("PowerShell を起動できません: {err}"))?;
    let write_result = child
        .stdin
        .take()
        .expect("piped stdin")
        .write_all(SCRIPT.as_bytes());
    if let Err(err) = write_result {
        let _ = child.kill();
        let _ = child.wait();
        return Err(format!("PowerShell に操作スクリプトを渡せません: {err}"));
    }
    // The fixed wrapper reads the complete UTF-8 source before executing it.
    // Dropping stdin above signals EOF and avoids the Windows command line limit.
    Ok(child)
}

fn run_action<T: DeserializeOwned>(action: &str, payload: serde_json::Value) -> Result<T, String> {
    #[cfg(not(windows))]
    {
        let _ = (action, payload);
        return Err("Hyper-V の操作には Windows が必要です。".into());
    }

    #[cfg(windows)]
    {
        let output = spawn_powershell(action, payload)?
            .wait_with_output()
            .map_err(|err| format!("PowerShell を起動できません: {err}"))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !output.status.success() {
            let detail = stderr.trim().trim_start_matches('\u{feff}');
            let fallback = stdout.trim().trim_start_matches('\u{feff}');
            return Err(if detail.is_empty() {
                if fallback.is_empty() {
                    "Hyper-V の操作に失敗しました。".to_string()
                } else {
                    fallback.to_string()
                }
            } else {
                detail.to_string()
            });
        }

        serde_json::from_str(stdout.trim().trim_start_matches('\u{feff}'))
            .map_err(|err| format!("Hyper-V の応答を読み取れません: {err}"))
    }
}

pub fn host_status() -> Result<HostStatus, String> {
    run_action("status", json!({}))
}

pub fn list_vms() -> Result<Vec<VmInfo>, String> {
    run_action("list", json!({}))
}

#[cfg(windows)]
fn vmconnect_command(id: &str) -> Result<Command, String> {
    use std::process::Stdio;

    validate_id(id)?;
    let mut command = Command::new(windows_system_directory()?.join("vmconnect.exe"));
    command
        .args(["localhost", "-G", &id.to_ascii_lowercase()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // VMConnect is a native GUI application; no shell, elevation, or console flags.
    Ok(command)
}

pub fn connect_vm(id: &str) -> Result<(), String> {
    validate_id(id)?;

    #[cfg(not(windows))]
    {
        Err("仮想マシン接続には Windows が必要です。".into())
    }

    #[cfg(windows)]
    {
        let vm: VmInfo = run_action("get", json!({ "id": id }))?;
        if !vm.id.eq_ignore_ascii_case(id) {
            return Err("接続先 VM を確認できません。一覧を更新してください。".into());
        }
        let mut command = vmconnect_command(id)?;
        let executable = std::path::Path::new(command.get_program());
        if !executable.is_file() {
            return Err(format!(
                "仮想マシン接続 (vmconnect.exe) が見つかりません: {}",
                executable.display()
            ));
        }
        let child = command
            .spawn()
            .map_err(|err| format!("仮想マシン接続ウィンドウを起動できません: {err}"))?;
        // Releasing the process handle leaves the independent window open. A
        // successful spawn only means VMConnect was launched, not connected.
        drop(child);
        Ok(())
    }
}

pub fn iso_users(path: &str) -> Result<Vec<String>, String> {
    run_action("iso_users", json!({"path": path}))
}

pub fn list_vm_network_adapters(id: &str) -> Result<Vec<VmNetworkAdapter>, String> {
    validate_id(id)?;
    run_action("list_network_adapters", json!({ "id": id }))
}

pub fn get_vm_boot_settings(id: &str) -> Result<VmBootSettings, String> {
    validate_id(id)?;
    run_action("get_boot_settings", json!({ "id": id }))
}

fn validate_boot_settings(request: &SaveVmBootSettingsRequest) -> Result<(), String> {
    validate_id(&request.vm_id)?;
    if request.expected_revision.len() != 64
        || !request
            .expected_revision
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("取得時の起動設定を確認できません。再読み込みしてください。".into());
    }
    if request.boot_order.len() > 1024 {
        return Err("起動エントリーが多すぎます。Hyper-V で設定を確認してください。".into());
    }
    let mut ids = std::collections::HashSet::new();
    for id in &request.boot_order {
        let index = id
            .strip_prefix("boot-")
            .and_then(|value| value.parse::<usize>().ok());
        if !index.is_some_and(|value| value < 1024 && id == &format!("boot-{value}"))
            || !ids.insert(id)
        {
            return Err("起動エントリーの指定が正しくありません。再読み込みしてください。".into());
        }
    }
    Ok(())
}

pub fn save_vm_boot_settings(request: SaveVmBootSettingsRequest) -> Result<VmBootSettings, String> {
    validate_boot_settings(&request)?;
    run_action(
        "save_boot_settings",
        serde_json::to_value(request).map_err(|err| err.to_string())?,
    )
}

pub fn save_vm_network_adapters(
    request: SaveVmNetworkAdaptersRequest,
) -> Result<Vec<VmNetworkAdapter>, String> {
    validate_id(&request.vm_id)?;
    let expected: Vec<NetworkAdapterRequest> = request
        .expected_adapter_ids
        .iter()
        .map(|id| NetworkAdapterRequest {
            id: Some(id.clone()),
            switch_name: None,
        })
        .collect();
    validate_network_adapters(&expected, false)?;
    validate_network_adapters(&request.adapters, false)?;
    run_action(
        "save_network_adapters",
        serde_json::to_value(request).map_err(|err| err.to_string())?,
    )
}

fn validate_network_adapters(
    adapters: &[NetworkAdapterRequest],
    creating: bool,
) -> Result<(), String> {
    if adapters.len() > 8 {
        return Err("ネットワークアダプターは 0〜8 個で指定してください。".into());
    }
    let mut ids = std::collections::HashSet::new();
    for adapter in adapters {
        if let Some(id) = &adapter.id {
            if creating || id.is_empty() || id.len() > 256 || id.chars().any(char::is_control) {
                return Err("ネットワークアダプター ID が正しくありません。".into());
            }
            if !ids.insert(id.to_ascii_lowercase()) {
                return Err("同じネットワークアダプターが複数指定されています。".into());
            }
        }
        if adapter.switch_name.as_ref().is_some_and(|name| {
            name.trim().is_empty()
                || name.chars().count() > 256
                || name.chars().any(char::is_control)
        }) {
            return Err("仮想スイッチ名が正しくありません。".into());
        }
    }
    Ok(())
}

fn validate_id(id: &str) -> Result<(), String> {
    let bytes = id.as_bytes();
    let valid = bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                *byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        });
    if valid {
        Ok(())
    } else {
        Err("VM ID の形式が正しくありません。".into())
    }
}

pub fn start_vm(id: &str) -> Result<VmInfo, String> {
    validate_id(id)?;
    run_action("start", json!({ "id": id }))
}

pub fn stop_vm(id: &str) -> Result<VmInfo, String> {
    validate_id(id)?;
    run_action("stop", json!({ "id": id }))
}

pub fn rename_vm(mut request: RenameVmRequest) -> Result<VmInfo, String> {
    validate_id(&request.id)?;
    validate_name(&request.name)?;
    request.name = request.name.trim().to_string();
    run_action(
        "rename",
        serde_json::to_value(request).map_err(|err| err.to_string())?,
    )
}

fn validate_delete(request: &DeleteVmRequest) -> Result<(), String> {
    validate_id(&request.id)?;
    if request.expected_name.is_empty()
        || request.expected_name.chars().count() > 256
        || request.expected_name.chars().any(char::is_control)
    {
        return Err("削除対象の VM 名が正しくありません。一覧を更新してください。".into());
    }
    if request.confirmation_name != request.expected_name {
        return Err("確認用の VM 名が一致しません。大文字・小文字や空白も含めて同じ名前を入力してください。".into());
    }
    if request.expected_disk_paths.len() > 256
        || request
            .expected_disk_paths
            .iter()
            .any(|path| path.is_empty() || path.len() > 32768 || path.chars().any(char::is_control))
    {
        return Err("確認用のディスク一覧が正しくありません。一覧を更新してください。".into());
    }
    Ok(())
}

pub fn get_vm_delete_info(id: &str) -> Result<VmDeleteInfo, String> {
    validate_id(id)?;
    run_action("delete_info", json!({ "id": id }))
}

pub fn delete_vm(request: DeleteVmRequest) -> Result<DeleteVmResult, String> {
    validate_delete(&request)?;
    run_action(
        "delete",
        serde_json::to_value(request).map_err(|err| err.to_string())?,
    )
}

fn validate_name(value: &str) -> Result<(), String> {
    let name = value.trim();
    if name.is_empty() || name.chars().count() > 64 {
        return Err("VM 名は 1〜64 文字で入力してください。".into());
    }
    if name == "."
        || name == ".."
        || name.ends_with([' ', '.'])
        || name
            .chars()
            .any(|character| character.is_control() || "<>:\"/\\|?*".contains(character))
    {
        return Err("VM 名にファイル名として使えない文字が含まれています。".into());
    }
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    if ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit()
            && stem.as_bytes()[3] != b'0')
    {
        return Err("この VM 名は Windows の予約名です。".into());
    }
    Ok(())
}

fn validate_create(request: &CreateVmRequest) -> Result<(), String> {
    validate_name(&request.name)?;
    if let Some(adapters) = &request.network_adapters {
        validate_network_adapters(adapters, true)?;
    }
    if request.generation != 1 && request.generation != 2 {
        return Err("VM 世代は 1 または 2 を指定してください。".into());
    }
    if !(512..=131_072).contains(&request.memory_startup_mb) {
        return Err("起動メモリは 512〜131072 MB の範囲で指定してください。".into());
    }
    if !(8..=2048).contains(&request.vhd_size_gb) {
        return Err("仮想ディスクは 8〜2048 GB の範囲で指定してください。".into());
    }
    if !(1..=64).contains(&request.cpu_count) {
        return Err("vCPU は 1〜64 個の範囲で指定してください。".into());
    }
    if request
        .switch_name
        .as_ref()
        .is_some_and(|name| name.trim().is_empty())
    {
        return Err("仮想スイッチ名を指定してください。".into());
    }
    if request
        .iso_path
        .as_ref()
        .is_some_and(|path| path.trim().is_empty())
    {
        return Err("ISO のパスを指定してください。".into());
    }
    Ok(())
}

pub fn create_vm(mut request: CreateVmRequest) -> Result<VmInfo, String> {
    validate_create(&request)?;
    request.name = request.name.trim().to_string();
    run_action(
        "create",
        serde_json::to_value(request).map_err(|err| err.to_string())?,
    )
}

pub fn clone_vm<F>(mut request: CloneVmRequest, mut on_progress: F) -> Result<VmInfo, String>
where
    F: FnMut(CloneProgress),
{
    validate_id(&request.source_id)?;
    validate_name(&request.name)?;
    request.name = request.name.trim().to_string();
    validate_clone_guest(&request)?;

    #[cfg(not(windows))]
    {
        let _ = (request, on_progress);
        Err("Hyper-V の操作には Windows が必要です。".into())
    }

    #[cfg(windows)]
    {
        use std::io::{BufReader, Read};

        let payload = serde_json::to_value(request).map_err(|err| err.to_string())?;
        let mut child = spawn_powershell("clone", payload)?;
        let stdout = child.stdout.take().expect("piped stdout");
        let mut stderr = child.stderr.take().expect("piped stderr");
        // Drain stderr concurrently so a full error pipe cannot stall a long copy.
        let stderr_reader = std::thread::spawn(move || {
            let mut bytes = Vec::new();
            stderr.read_to_end(&mut bytes).map(|_| bytes)
        });
        let result = read_clone_events(BufReader::new(stdout), &mut on_progress);
        let status = child
            .wait()
            .map_err(|err| format!("複製処理の終了を確認できません: {err}"))?;
        let stderr = stderr_reader
            .join()
            .map_err(|_| "複製エラーの読み取り処理に失敗しました。".to_string())?
            .map_err(|err| format!("複製エラーを読み取れません: {err}"))?;
        if !status.success() {
            let detail = String::from_utf8_lossy(&stderr);
            let detail = detail.trim().trim_start_matches('\u{feff}');
            return Err(if detail.is_empty() {
                "VM の複製に失敗しました。".into()
            } else {
                detail.to_string()
            });
        }
        result
    }
}

fn validate_clone_guest(request: &CloneVmRequest) -> Result<(), String> {
    if let Some(hostname) = &request.guest_hostname {
        let bytes = hostname.as_bytes();
        if bytes.is_empty()
            || bytes.len() > 63
            || !bytes[0].is_ascii_lowercase() && !bytes[0].is_ascii_digit()
            || !bytes[bytes.len() - 1].is_ascii_lowercase()
                && !bytes[bytes.len() - 1].is_ascii_digit()
            || bytes
                .iter()
                .any(|byte| !byte.is_ascii_lowercase() && !byte.is_ascii_digit() && *byte != b'-')
        {
            return Err("ホスト名は 1〜63 文字の英小文字・数字・ハイフンで指定し、先頭と末尾には英小文字か数字を使ってください。".into());
        }
        let path = request
            .guest_seed_path
            .as_ref()
            .ok_or_else(|| "ホスト名設定用の OS 設定イメージが用意されていません。".to_string())?;
        let path = std::path::Path::new(path);
        if !path.is_absolute()
            || !path.is_file()
            || !path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("iso"))
        {
            return Err("OS 設定イメージのパスが正しくありません。".into());
        }
        if request.guest_macs.len() > 8
            || request.guest_macs.len() != request.guest_adapter_ids.len()
        {
            return Err("複製 VM のネットワーク設定数が正しくありません。".into());
        }
        let mut macs = std::collections::HashSet::new();
        for mac in &request.guest_macs {
            if mac.len() != 12
                || !mac.starts_with("02")
                || !mac.bytes().all(|b| b.is_ascii_hexdigit())
                || !macs.insert(mac.to_ascii_lowercase())
            {
                return Err("複製 VM の MAC アドレスが正しくありません。".into());
            }
        }
    } else if request.guest_seed_path.is_some()
        || !request.guest_macs.is_empty()
        || !request.guest_adapter_ids.is_empty()
    {
        return Err("OS 設定イメージにはホスト名の指定が必要です。".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_valid_vm_specification() {
        let request = CreateVmRequest {
            name: "開発 VM".into(),
            generation: 2,
            memory_startup_mb: 8192,
            vhd_size_gb: 200,
            cpu_count: 2,
            switch_name: None,
            network_adapters: None,
            iso_path: None,
            iso_id: None,
            iso_os_family: None,
        };
        assert!(validate_create(&request).is_ok());
    }

    #[test]
    fn create_defaults_match_requested_resources_without_overriding_custom_values() {
        let defaults: CreateVmRequest =
            serde_json::from_value(json!({ "name": "test", "cpu_count": 2 })).unwrap();
        assert_eq!(defaults.generation, 2);
        assert_eq!(
            u64::from(defaults.memory_startup_mb) * 1024 * 1024,
            8589934592
        );
        assert_eq!(
            u64::from(defaults.vhd_size_gb) * 1024 * 1024 * 1024,
            214748364800
        );
        assert!(validate_create(&defaults).is_ok());

        let custom: CreateVmRequest = serde_json::from_value(json!({
            "name": "custom", "cpu_count": 1, "generation": 1,
            "memory_startup_mb": 1024, "vhd_size_gb": 16
        }))
        .unwrap();
        assert_eq!(
            (
                custom.generation,
                custom.memory_startup_mb,
                custom.vhd_size_gb
            ),
            (1, 1024, 16)
        );
        assert!(validate_create(&custom).is_ok());
    }

    #[test]
    fn rejects_invalid_name_and_resource_limits() {
        let mut request = CreateVmRequest {
            name: "../escape".into(),
            generation: 2,
            memory_startup_mb: 4096,
            vhd_size_gb: 64,
            cpu_count: 2,
            switch_name: None,
            network_adapters: None,
            iso_path: None,
            iso_id: None,
            iso_os_family: None,
        };
        assert!(validate_create(&request).is_err());
        request.name = "valid".into();
        request.vhd_size_gb = 0;
        assert!(validate_create(&request).is_err());
    }

    #[test]
    fn accepts_only_guid_ids() {
        assert!(validate_id("c523a297-4a1d-4ff8-ad96-915f76c74a3c").is_ok());
        assert!(validate_id("vm-name").is_err());
    }

    #[test]
    fn boot_settings_validate_revision_and_opaque_entry_ids_before_powershell() {
        let mut request = SaveVmBootSettingsRequest {
            vm_id: "c523a297-4a1d-4ff8-ad96-915f76c74a3c".into(),
            expected_revision: "ab".repeat(32),
            secure_boot_enabled: Some(false),
            boot_order: vec!["boot-2".into(), "boot-0".into(), "boot-1".into()],
        };
        assert!(validate_boot_settings(&request).is_ok());
        for order in [
            vec!["boot-0", "boot-0"],
            vec!["boot-01"],
            vec!["boot-1024"],
            vec!["disk-from-another-vm"],
        ] {
            request.boot_order = order.into_iter().map(str::to_owned).collect();
            assert!(validate_boot_settings(&request).is_err());
        }
        request.boot_order.clear();
        assert!(validate_boot_settings(&request).is_ok());
        request.expected_revision = "not-a-revision".into();
        assert!(save_vm_boot_settings(request)
            .unwrap_err()
            .contains("再読み込み"));
        assert!(get_vm_boot_settings("not-an-id")
            .unwrap_err()
            .contains("VM ID"));
    }

    #[test]
    fn boot_settings_distinguish_secure_boot_unchanged_from_disable() {
        let base = json!({
            "vm_id": "c523a297-4a1d-4ff8-ad96-915f76c74a3c",
            "expected_revision": "ab".repeat(32), "boot_order": []
        });
        let unchanged: SaveVmBootSettingsRequest = serde_json::from_value(base.clone()).unwrap();
        assert_eq!(unchanged.secure_boot_enabled, None);
        let mut disabled = base;
        disabled["secure_boot_enabled"] = json!(false);
        let disabled: SaveVmBootSettingsRequest = serde_json::from_value(disabled).unwrap();
        assert_eq!(disabled.secure_boot_enabled, Some(false));
    }

    #[test]
    fn connect_rejects_names_and_command_text_before_reading_or_launching() {
        for id in [
            "vm-name",
            "c523a297-4a1d-4ff8-ad96-915f76c74a3c -C 10",
            "c523a297-4a1d-4ff8-ad96-915f76c74a3c;Start-VM vm",
            "{c523a297-4a1d-4ff8-ad96-915f76c74a3c}",
        ] {
            assert!(connect_vm(id).unwrap_err().contains("VM ID"));
        }
    }

    #[cfg(windows)]
    #[test]
    fn connect_command_uses_system_executable_and_separate_canonical_guid_argument() {
        let command = vmconnect_command("C523A297-4A1D-4FF8-AD96-915F76C74A3C").unwrap();
        let expected = windows_system_directory().unwrap().join("vmconnect.exe");
        assert!(expected.is_absolute());
        assert_eq!(command.get_program(), expected.as_os_str());
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            [
                std::ffi::OsStr::new("localhost"),
                std::ffi::OsStr::new("-G"),
                std::ffi::OsStr::new("c523a297-4a1d-4ff8-ad96-915f76c74a3c"),
            ]
        );
        assert!(vmconnect_command("valid-looking-name; cmd.exe").is_err());
    }

    #[test]
    fn rename_rejects_invalid_identity_and_name_before_launching_powershell() {
        assert!(rename_vm(RenameVmRequest {
            id: "not-a-guid".into(),
            name: "valid".into()
        })
        .unwrap_err()
        .contains("VM ID"));
        assert!(rename_vm(RenameVmRequest {
            id: "c523a297-4a1d-4ff8-ad96-915f76c74a3c".into(),
            name: "../invalid".into()
        })
        .unwrap_err()
        .contains("VM 名"));
    }

    #[test]
    fn delete_requires_exact_confirmation_without_normalizing_existing_names() {
        let mut request = DeleteVmRequest {
            id: "c523a297-4a1d-4ff8-ad96-915f76c74a3c".into(),
            expected_name: "Legacy:VM [元] ".into(),
            confirmation_name: "Legacy:VM [元] ".into(),
            delete_disks: false,
            expected_disk_paths: Vec::new(),
        };
        assert!(validate_delete(&request).is_ok());
        request.confirmation_name = "legacy:VM [元] ".into();
        assert!(validate_delete(&request).is_err());
        request.confirmation_name = request.expected_name.trim().into();
        assert!(validate_delete(&request).is_err());
        request.expected_name = "invalid\nname".into();
        request.confirmation_name = request.expected_name.clone();
        assert!(validate_delete(&request).is_err());
        request.id = "not-a-guid".into();
        assert!(delete_vm(request).unwrap_err().contains("VM ID"));
    }

    #[cfg(windows)]
    #[test]
    fn powershell_stdin_transport_returns_utf8_json_and_closes_input() {
        let status = host_status().expect("fixed UTF-8 script must return valid host status JSON");
        assert!(!status.computer_name.is_empty());
        assert!(status.can_manage || status.error.is_some());
    }

    #[test]
    fn network_requests_reject_duplicate_foreign_creation_ids_and_limits() {
        let adapter = || NetworkAdapterRequest {
            id: Some("Microsoft:c523a297-4a1d-4ff8-ad96-915f76c74a3c\\device".into()),
            switch_name: None,
        };
        assert!(validate_network_adapters(&[adapter()], true).is_err());
        assert!(validate_network_adapters(&[adapter(), adapter()], false).is_err());
        let many: Vec<_> = (0..9)
            .map(|_| NetworkAdapterRequest {
                id: None,
                switch_name: None,
            })
            .collect();
        assert!(validate_network_adapters(&many, true).is_err());
        assert!(validate_network_adapters(&[], true).is_ok());
        assert!(validate_network_adapters(
            &[NetworkAdapterRequest {
                id: None,
                switch_name: Some("\n".into())
            }],
            false
        )
        .is_err());
    }

    #[test]
    fn create_distinguishes_omitted_networks_from_explicit_zero_adapters() {
        let mut value = json!({ "name": "test", "generation": 2, "memory_startup_mb": 512, "vhd_size_gb": 8, "cpu_count": 1 });
        let legacy: CreateVmRequest = serde_json::from_value(value.clone()).unwrap();
        assert!(legacy.network_adapters.is_none());
        value["network_adapters"] = json!([]);
        let zero: CreateVmRequest = serde_json::from_value(value).unwrap();
        assert_eq!(zero.network_adapters.unwrap().len(), 0);
    }

    #[test]
    fn clone_validates_identity_before_launching_powershell() {
        let mut request = CloneVmRequest {
            source_id: "not-an-id".into(),
            name: "copy".into(),
            connect_network: false,
            guest_hostname: None,
            guest_seed_path: None,
            guest_macs: Vec::new(),
            guest_adapter_ids: Vec::new(),
        };
        assert!(clone_vm(request, |_| {}).unwrap_err().contains("VM ID"));
        request = CloneVmRequest {
            source_id: "c523a297-4a1d-4ff8-ad96-915f76c74a3c".into(),
            name: "../origin".into(),
            connect_network: false,
            guest_hostname: None,
            guest_seed_path: None,
            guest_macs: Vec::new(),
            guest_adapter_ids: Vec::new(),
        };
        assert!(clone_vm(request, |_| {}).unwrap_err().contains("VM 名"));
    }

    #[test]
    fn clone_protocol_distinguishes_progress_from_vm_result() {
        let event: CloneEvent = serde_json::from_str(
            r#"{"kind":"progress","progress":{"phase":"exporting","message":"コピー中"}}"#,
        )
        .unwrap();
        assert!(
            matches!(event, CloneEvent::Progress { progress } if progress.phase == "exporting")
        );
        let request: CloneVmRequest = serde_json::from_str(
            r#"{"source_id":"c523a297-4a1d-4ff8-ad96-915f76c74a3c","name":"copy"}"#,
        )
        .unwrap();
        assert!(!request.connect_network);
    }

    fn clone_result_line() -> String {
        json!({
            "kind": "result",
            "value": {
                "id": "da6d052e-9b7f-45c7-950b-87c09af66bb5",
                "name": "copied VM",
                "state": "Off",
                "generation": 2,
                "memory_startup_bytes": 4294967296_u64,
                "memory_assigned_bytes": 0,
                "processor_count": 2,
                "uptime_seconds": 0
            }
        })
        .to_string()
    }

    #[test]
    fn clone_stream_delivers_progress_and_one_result() {
        let stream = format!(
            "\u{feff}{}\n{}\n",
            r#"{"kind":"progress","progress":{"phase":"importing","message":"新しい ID"}}"#,
            clone_result_line()
        );
        let mut phases = Vec::new();
        let vm = read_clone_events(std::io::Cursor::new(stream), &mut |event| {
            phases.push(event.phase);
        })
        .unwrap();
        assert_eq!(phases, ["importing"]);
        assert_eq!(vm.name, "copied VM");
        assert_eq!(vm.state, "Off");
    }

    #[test]
    fn clone_stream_rejects_missing_duplicate_and_corrupt_results() {
        assert!(read_clone_events(std::io::Cursor::new(""), &mut |_| {}).is_err());
        let duplicate = format!("{}\n{}\n", clone_result_line(), clone_result_line());
        assert!(
            read_clone_events(std::io::Cursor::new(duplicate), &mut |_| {})
                .unwrap_err()
                .contains("重複")
        );
        let corrupt = format!("not JSON\n{}\n", clone_result_line());
        assert!(
            read_clone_events(std::io::Cursor::new(corrupt), &mut |_| {})
                .unwrap_err()
                .contains("応答")
        );
    }

    #[test]
    fn clone_does_not_accept_internal_seed_or_mac_from_frontend() {
        let request: CloneVmRequest = serde_json::from_value(json!({
            "source_id": "c523a297-4a1d-4ff8-ad96-915f76c74a3c",
            "name": "copy",
            "guest_seed_path": "C:\\arbitrary.iso",
            "guest_macs": ["02FFFFFFFFFF"],
            "guest_adapter_ids": ["foreign"]
        }))
        .unwrap();
        assert!(request.guest_seed_path.is_none());
        assert!(request.guest_macs.is_empty());
        assert!(request.guest_adapter_ids.is_empty());
        assert!(validate_clone_guest(&request).is_ok());
    }

    #[test]
    fn clone_rejects_invalid_hostnames_and_unprepared_guest_settings() {
        for hostname in ["", "UPPER", "-host", "host-", "a.b", "$(cmd)"] {
            let request: CloneVmRequest = serde_json::from_value(json!({
                "source_id": "c523a297-4a1d-4ff8-ad96-915f76c74a3c",
                "name": "copy",
                "guest_hostname": hostname
            }))
            .unwrap();
            assert!(validate_clone_guest(&request)
                .unwrap_err()
                .contains("ホスト名"));
        }
        let request: CloneVmRequest = serde_json::from_value(json!({
            "source_id": "c523a297-4a1d-4ff8-ad96-915f76c74a3c",
            "name": "copy",
            "guest_hostname": "app-01"
        }))
        .unwrap();
        assert!(validate_clone_guest(&request)
            .unwrap_err()
            .contains("イメージ"));
    }
}
