export type VmNetworkAdapter = {
  id: string;
  name: string;
  switch_name: string | null;
  mac_address: string;
  is_legacy: boolean;
};

export type NetworkAdapterDraft = {
  key: string;
  id?: string;
  name?: string;
  switchName: string;
  macAddress?: string;
  isLegacy?: boolean;
};

export function newNetworkAdapter(): NetworkAdapterDraft {
  return { key: crypto.randomUUID(), switchName: "" };
}

export function networkAdapterDrafts(adapters: VmNetworkAdapter[]): NetworkAdapterDraft[] {
  return adapters.map((adapter) => ({ key: crypto.randomUUID(), id: adapter.id, name: adapter.name, switchName: adapter.switch_name || "", macAddress: adapter.mac_address, isLegacy: adapter.is_legacy }));
}

function formatMac(value: string): string {
  const digits = value.replace(/[:-]/g, "");
  return /^[a-f0-9]{12}$/i.test(digits) ? digits.match(/.{2}/g)!.join(":").toUpperCase() : value;
}

export default function NetworkAdaptersEditor({ adapters, switches, onChange, disabled = false, readOnly = false }: {
  adapters: NetworkAdapterDraft[];
  switches: string[];
  onChange: (adapters: NetworkAdapterDraft[]) => void;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  const locked = disabled || readOnly;
  return <div className="network-adapters-editor">
    {adapters.length === 0 ? <p className="network-adapters-empty">NICはありません。</p> : <div className="network-adapter-list">
      {adapters.map((adapter, index) => <div className="network-adapter-row" key={adapter.key}>
        <div className="network-adapter-heading"><strong>NIC {index + 1}</strong>{adapter.isLegacy && <span>レガシー</span>}{!readOnly && <button className="text-button" type="button" disabled={disabled} onClick={() => onChange(adapters.filter((item) => item.key !== adapter.key))} aria-label={`NIC ${index + 1} を削除`}>削除</button>}</div>
        {adapter.name && <p className="network-adapter-name">{adapter.name}</p>}
        <div className="form-field network-switch-field"><label htmlFor={`network-switch-${adapter.key}`}>仮想スイッチ</label><select id={`network-switch-${adapter.key}`} aria-label={`NIC ${index + 1} の仮想スイッチ`} value={adapter.switchName} disabled={locked} onChange={(event) => onChange(adapters.map((item) => item.key === adapter.key ? { ...item, switchName: event.target.value } : item))}><option value="">接続しない</option>{adapter.switchName && !switches.includes(adapter.switchName) && <option value={adapter.switchName}>{adapter.switchName}（現在の接続先）</option>}{switches.map((switchName) => <option key={switchName} value={switchName}>{switchName}</option>)}</select></div>
        {adapter.macAddress && <small className="network-adapter-mac">MAC {formatMac(adapter.macAddress)}</small>}
      </div>)}
    </div>}
    <div className="network-adapter-footer">{!readOnly && <button className="secondary-button" type="button" disabled={disabled || adapters.length >= 8} onClick={() => onChange([...adapters, newNetworkAdapter()])}>＋ NICを追加</button>}<span>{adapters.length} / 8 NIC</span></div>
  </div>;
}
