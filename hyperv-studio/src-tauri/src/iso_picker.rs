use tauri_plugin_dialog::DialogExt;

/// Opens the native file picker for an ISO image.
///
/// Call this from a blocking worker, not the Tauri UI thread. `Ok(None)` means
/// the picker was dismissed without choosing a file.
pub fn pick_iso_file(window: &tauri::WebviewWindow) -> Result<Option<String>, String> {
    let selected = window
        .dialog()
        .file()
        .set_parent(window)
        .set_title("ISO イメージを選択")
        .add_filter("ISO イメージ", &["iso"])
        .blocking_pick_file();

    let Some(selected) = selected else {
        return Ok(None);
    };

    let path = selected
        .into_path()
        .map_err(|error| format!("選択した ISO のパスを読み取れません: {error}"))?;

    if !path.is_absolute() {
        return Err("ISO の絶対パスを選択してください。".into());
    }

    if !path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("iso"))
    {
        return Err(".iso ファイルを選択してください。".into());
    }

    let path = path
        .to_str()
        .ok_or("選択した ISO のパスを文字列に変換できません。")?;
    Ok(Some(path.to_owned()))
}
