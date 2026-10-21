import { useState } from "react";
import { formatIsoSize, type IsoLibraryController, type OsFamily } from "./useIsoLibrary";

export const osFamilyLabel: Record<OsFamily, string> = { windows: "Windows", linux: "Linux", other: "その他" };

function inferFamily(path: string): OsFamily {
  if (/windows|win(?:10|11|server)/i.test(path)) return "windows";
  if (/alma|rocky|rhel|red.?hat|ubuntu|debian|fedora|centos|linux|suse|arch/i.test(path)) return "linux";
  return "other";
}

export default function IsoLibrarySettings({ controller }: { controller: IsoLibraryController }) {
  const [sourcePath, setSourcePath] = useState("");
  const [name, setName] = useState("");
  const [family, setFamily] = useState<OsFamily>("linux");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const progress = controller.progress;
  const percent = progress && progress.total_bytes > 0 ? Math.min(100, Math.floor(progress.copied_bytes / progress.total_bytes * 100)) : 0;

  async function chooseFile() {
    const selected = await controller.pickFile();
    if (!selected) return;
    setSourcePath(selected);
    setName((selected.split(/[\\/]/).pop() ?? "").replace(/\.iso$/i, ""));
    setFamily(inferFamily(selected));
    setNotice(null);
  }

  async function importImage() {
    if (!sourcePath || !name.trim() || controller.busy) return;
    setNotice(null);
    const image = await controller.importImage({ source_path: sourcePath, name: name.trim(), os_family: family });
    if (image) { setSourcePath(""); setName(""); setNotice(`「${image.name}」を取り込みました。`); }
  }

  async function removeImage(id: string) {
    setNotice(null);
    if (await controller.removeImage(id)) { setConfirmId(null); setNotice("ISOをライブラリから削除しました。"); }
  }

  return (
    <>
      <h3>OSイメージ</h3>
      <p className="settings-description">ISOをアプリに保管し、新しいVMのOSとして選択できます。</p>
      {controller.error && <p className="settings-error" role="alert">{controller.error}</p>}
      {notice && <p className="iso-notice" role="status">{notice}</p>}
      <form className="iso-import-form" onSubmit={(event) => { event.preventDefault(); void importImage(); }}>
        <div className="iso-import-heading"><h4>ISOを取り込む</h4><button className="secondary-button" type="button" disabled={controller.busy} onClick={() => void chooseFile()}>ISOを選択</button></div>
        {sourcePath ? (
          <>
            <p className="iso-source-path" title={sourcePath}>{sourcePath}</p>
            <div className="iso-import-fields">
              <div className="form-field"><label htmlFor="iso-name">OS名</label><input id="iso-name" value={name} maxLength={100} required disabled={controller.busy} onChange={(event) => setName(event.target.value)} /></div>
              <div className="form-field"><label htmlFor="iso-family">OSの種類</label><select id="iso-family" value={family} disabled={controller.busy} onChange={(event) => setFamily(event.target.value as OsFamily)}><option value="linux">Linux</option><option value="windows">Windows</option><option value="other">その他</option></select></div>
            </div>
            <div className="iso-import-actions"><span>元のファイルを残し、アプリの保管先へコピーします。</span><button className="primary-button" type="submit" disabled={controller.busy || !name.trim()}>取り込む</button></div>
          </>
        ) : <p className="iso-import-hint">このPCの.isoファイルを選択してください。</p>}
        {progress && <div className="iso-copy-progress" role="status"><div><span>取り込み中… {percent}%</span><span>{formatIsoSize(progress.copied_bytes)} / {formatIsoSize(progress.total_bytes)}</span></div><progress aria-label="ISOの取り込み" max={100} value={percent} /><p>コピーが終わるまでアプリを開いたままにしてください。</p></div>}
      </form>
      <div className="iso-library-heading"><h4>保管中のISO <span>{controller.library?.images.length ?? 0}</span></h4><button className="text-button" type="button" disabled={controller.busy || controller.loading} onClick={() => void controller.refresh()}>更新</button></div>
      <div className="iso-library-list" aria-busy={controller.loading}>
        {controller.loading && !controller.library ? <p className="iso-empty">読み込み中…</p> : !controller.library?.images.length ? <p className="iso-empty">ISOはまだありません。上から取り込むと、新規VM作成時に選べます。</p> : controller.library.images.map((image) => (
          <div className="iso-library-item" key={image.id}>
            <div className="iso-library-item-main"><div><strong>{image.name}</strong><span className="iso-family-label">{osFamilyLabel[image.os_family]}</span></div><p title={image.file_name}>{image.file_name}</p><span className={image.available ? "iso-size" : "iso-unavailable"}>{image.available ? formatIsoSize(image.size_bytes) : "ファイルが見つかりません"}</span></div>
            <button className="text-button iso-delete" type="button" aria-label={`${image.name}を削除`} disabled={controller.busy} onClick={() => setConfirmId(confirmId === image.id ? null : image.id)}>削除</button>
            {confirmId === image.id && <div className="iso-delete-confirm"><p>ライブラリ内のコピーを削除します。元のISOは残ります。</p><div><button className="secondary-button" type="button" disabled={controller.busy} onClick={() => setConfirmId(null)}>キャンセル</button><button className="secondary-button" type="button" disabled={controller.busy} onClick={() => void removeImage(image.id)}>削除する</button></div></div>}
          </div>
        ))}
      </div>
      {controller.library?.directory && <div className="iso-storage-location"><span>保管先</span><code>{controller.library.directory}</code></div>}
    </>
  );
}
