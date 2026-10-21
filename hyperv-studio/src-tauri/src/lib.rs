mod hyperv;
mod iso_library;
mod iso_picker;
mod linux_seed;

use hyperv::{
    CloneProgress, CloneVmRequest, CreateVmRequest, DeleteVmRequest, DeleteVmResult, HostStatus,
    RenameVmRequest, SaveVmBootSettingsRequest, SaveVmNetworkAdaptersRequest, VmBootSettings,
    VmDeleteInfo, VmInfo, VmNetworkAdapter,
};
use iso_library::{ImportIsoRequest, IsoImage, IsoImportProgress, IsoLibrary};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::Manager;

#[derive(Default)]
struct LibraryState(Arc<Mutex<()>>);

fn library_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("iso-library"))
        .map_err(|error| error.to_string())
}

fn windows_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        text.strip_prefix(r"\\?\").unwrap_or(&text).to_string()
    }
}

#[tauri::command]
async fn get_host_status() -> Result<HostStatus, String> {
    tauri::async_runtime::spawn_blocking(hyperv::host_status)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_vms() -> Result<Vec<VmInfo>, String> {
    tauri::async_runtime::spawn_blocking(hyperv::list_vms)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_vm_delete_info(
    state: tauri::State<'_, LibraryState>,
    id: String,
) -> Result<VmDeleteInfo, String> {
    let gate = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate
            .lock()
            .map_err(|_| "VM操作のロックを取得できません。".to_string())?;
        hyperv::get_vm_delete_info(&id)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn delete_vm(
    state: tauri::State<'_, LibraryState>,
    request: DeleteVmRequest,
) -> Result<DeleteVmResult, String> {
    let gate = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate
            .lock()
            .map_err(|_| "VM操作のロックを取得できません。".to_string())?;
        hyperv::delete_vm(request)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn rename_vm(
    state: tauri::State<'_, LibraryState>,
    request: RenameVmRequest,
) -> Result<VmInfo, String> {
    let gate = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate
            .lock()
            .map_err(|_| "VM操作のロックを取得できません。".to_string())?;
        hyperv::rename_vm(request)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_vm_boot_settings(
    state: tauri::State<'_, LibraryState>,
    id: String,
) -> Result<VmBootSettings, String> {
    let gate = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate
            .lock()
            .map_err(|_| "VM操作のロックを取得できません。".to_string())?;
        hyperv::get_vm_boot_settings(&id)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_vm_boot_settings(
    state: tauri::State<'_, LibraryState>,
    request: SaveVmBootSettingsRequest,
) -> Result<VmBootSettings, String> {
    let gate = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate
            .lock()
            .map_err(|_| "VM操作のロックを取得できません。".to_string())?;
        hyperv::save_vm_boot_settings(request)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_vm_network_adapters(id: String) -> Result<Vec<VmNetworkAdapter>, String> {
    tauri::async_runtime::spawn_blocking(move || hyperv::list_vm_network_adapters(&id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_vm_network_adapters(
    state: tauri::State<'_, LibraryState>,
    request: SaveVmNetworkAdaptersRequest,
) -> Result<Vec<VmNetworkAdapter>, String> {
    let gate = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate
            .lock()
            .map_err(|_| "VM操作のロックを取得できません。".to_string())?;
        hyperv::save_vm_network_adapters(request)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn start_vm(state: tauri::State<'_, LibraryState>, id: String) -> Result<VmInfo, String> {
    let gate = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate
            .lock()
            .map_err(|_| "VM操作のロックを取得できません。".to_string())?;
        hyperv::start_vm(&id)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn connect_vm(state: tauri::State<'_, LibraryState>, id: String) -> Result<(), String> {
    let gate = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate
            .lock()
            .map_err(|_| "VM操作のロックを取得できません。".to_string())?;
        hyperv::connect_vm(&id)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn stop_vm(state: tauri::State<'_, LibraryState>, id: String) -> Result<VmInfo, String> {
    let gate = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate
            .lock()
            .map_err(|_| "VM操作のロックを取得できません。".to_string())?;
        hyperv::stop_vm(&id)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn create_vm(
    app: tauri::AppHandle,
    state: tauri::State<'_, LibraryState>,
    mut request: CreateVmRequest,
) -> Result<VmInfo, String> {
    let root = library_root(&app)?;
    let gate = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate
            .lock()
            .map_err(|_| "ISOライブラリのロックを取得できません。".to_string())?;
        if let Some(id) = request.iso_id.take() {
            if request.iso_path.is_some() {
                return Err("OSとISOパスは同時に指定できません。".into());
            }
            let (path, family) = iso_library::resolve(&root, &id)?;
            request.iso_path = Some(windows_path(&path));
            request.iso_os_family = Some(family);
        }
        hyperv::create_vm(request)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn clone_vm(
    app: tauri::AppHandle,
    state: tauri::State<'_, LibraryState>,
    mut request: CloneVmRequest,
    on_progress: tauri::ipc::Channel<CloneProgress>,
) -> Result<VmInfo, String> {
    let seed_root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("clone-seeds");
    let gate = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate
            .lock()
            .map_err(|_| "VM複製のロックを取得できません。".to_string())?;
        let seed = if let Some(hostname) = request.guest_hostname.as_ref() {
            let adapters = hyperv::list_vm_network_adapters(&request.source_id)?;
            request.guest_adapter_ids = adapters.iter().map(|adapter| adapter.id.clone()).collect();
            Some(linux_seed::prepare(&seed_root, hostname, adapters.len())?)
        } else {
            None
        };
        if let Some(seed) = &seed {
            request.guest_seed_path = Some(windows_path(&seed.iso_path));
            request.guest_macs = seed.macs.clone();
        }
        let result = hyperv::clone_vm(request, |progress| {
            // Closing the window must not interrupt an import that has already
            // created a VM. A completed copy can be found by refreshing the list.
            let _ = on_progress.send(progress);
        });
        // PowerShell copies this seed into the new VM's own directory before
        // attaching it. Only this operation's temporary seed is removed here.
        if let Some(seed) = seed {
            let _ = std::fs::remove_file(&seed.iso_path);
            if let Some(directory) = seed.iso_path.parent() {
                let _ = std::fs::remove_dir(directory);
            }
        }
        result
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_iso_images(
    app: tauri::AppHandle,
    state: tauri::State<'_, LibraryState>,
) -> Result<IsoLibrary, String> {
    let root = library_root(&app)?;
    let gate = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate
            .lock()
            .map_err(|_| "ISOライブラリのロックを取得できません。".to_string())?;
        iso_library::list(&root)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn pick_iso_file(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || iso_picker::pick_iso_file(&window))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn import_iso_image(
    app: tauri::AppHandle,
    state: tauri::State<'_, LibraryState>,
    request: ImportIsoRequest,
    on_progress: tauri::ipc::Channel<IsoImportProgress>,
) -> Result<IsoImage, String> {
    let root = library_root(&app)?;
    let gate = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate
            .lock()
            .map_err(|_| "ISOライブラリのロックを取得できません。".to_string())?;
        iso_library::import(&root, request, |progress| {
            on_progress
                .send(progress)
                .map_err(|error| format!("取り込み画面との接続が切れました: {error}"))
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn remove_iso_image(
    app: tauri::AppHandle,
    state: tauri::State<'_, LibraryState>,
    id: String,
) -> Result<(), String> {
    let root = library_root(&app)?;
    let gate = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate.lock().map_err(|_| "ISOライブラリのロックを取得できません。".to_string())?;
        if !iso_library::list(&root)?.images.iter().any(|image| image.id == id) { return Err("ISOが見つかりません。".into()); }
        let users = hyperv::iso_users(&windows_path(&root.join(&id).join("image.iso")))?;
        if !users.is_empty() { return Err(format!("このISOはVM「{}」で使用されています。DVDドライブから取り外してから削除してください。", users.join("、"))); }
        iso_library::remove(&root, &id)
    }).await.map_err(|error| error.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(LibraryState::default())
        .invoke_handler(tauri::generate_handler![
            get_host_status,
            list_vms,
            get_vm_delete_info,
            delete_vm,
            rename_vm,
            get_vm_boot_settings,
            save_vm_boot_settings,
            list_vm_network_adapters,
            save_vm_network_adapters,
            start_vm,
            connect_vm,
            stop_vm,
            create_vm,
            clone_vm,
            list_iso_images,
            pick_iso_file,
            import_iso_image,
            remove_iso_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running Hyper-V Studio");
}
