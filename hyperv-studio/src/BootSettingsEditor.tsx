export type VmBootEntry = { id: string; label: string; kind: string; detail: string | null };
export type VmBootSettings = { vm_id: string; name: string; state: string; generation: number; secure_boot_enabled: boolean | null; secure_boot_template: string | null; boot_entries: VmBootEntry[]; revision: string };

const kindLabels: Record<string, string> = { disk: "仮想ディスク", dvd: "DVD", network: "ネットワーク", file: "ファイル", unknown: "その他", legacy_network: "ネットワーク", cd: "CD", ide: "IDE" };

export default function BootSettingsEditor({ settings, entries, secureBootEnabled, onEntriesChange, onSecureBootChange, disabled = false, readOnly = false }: {
  settings: VmBootSettings;
  entries: VmBootEntry[];
  secureBootEnabled: boolean | null;
  onEntriesChange: (entries: VmBootEntry[]) => void;
  onSecureBootChange: (enabled: boolean) => void;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  const locked = disabled || readOnly;
  function moveEntry(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (locked || destination < 0 || destination >= entries.length) return;
    const next = [...entries];
    [next[index], next[destination]] = [next[destination], next[index]];
    onEntriesChange(next);
  }

  return <div className="boot-settings-editor">
    <section className="boot-security-section" aria-labelledby="boot-security-title">
      <h3 id="boot-security-title">Secure Boot</h3>
      {settings.generation === 2 ? <>
        <label className="boot-secure-option" htmlFor="boot-secure-boot"><input id="boot-secure-boot" type="checkbox" disabled={locked || secureBootEnabled === null} checked={secureBootEnabled === true} onChange={(event) => onSecureBootChange(event.target.checked)} /><span>Secure Bootを有効にする</span></label>
        {secureBootEnabled === null && <p className="boot-help">Secure Bootの状態を取得できませんでした。再取得してください。</p>}
        <div className="boot-template"><span>現在のテンプレート</span><code>{settings.secure_boot_template || "未設定"}</code></div>
      </> : <p className="boot-help">第1世代のVMはSecure Bootに対応していません。</p>}
    </section>
    <section className="boot-order-section" aria-labelledby="boot-order-title">
      <h3 id="boot-order-title">起動順序</h3><p className="boot-help">上から順に起動を試みます。</p>
      {entries.length === 0 ? <p className="boot-empty">起動項目がありません。</p> : <ol className="boot-order-list">{entries.map((entry, index) => <li className="boot-order-row" key={entry.id}>
        <span className="boot-order-number">{index + 1}</span>
        <div className="boot-order-copy"><div><strong>{entry.label || "起動項目"}</strong><span className="boot-entry-kind">{kindLabels[entry.kind] || entry.kind}</span></div>{entry.detail && <code>{entry.detail}</code>}</div>
        <div className="boot-order-actions"><button className="icon-button" type="button" disabled={locked || index === 0} aria-label={`起動項目 ${index + 1} を上へ`} title="上へ" onClick={() => moveEntry(index, -1)}>↑</button><button className="icon-button" type="button" disabled={locked || index === entries.length - 1} aria-label={`起動項目 ${index + 1} を下へ`} title="下へ" onClick={() => moveEntry(index, 1)}>↓</button></div>
      </li>)}</ol>}
    </section>
  </div>;
}
