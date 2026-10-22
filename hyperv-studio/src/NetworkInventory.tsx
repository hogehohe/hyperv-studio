import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import NetworkSwitchEditor, { type PhysicalNetworkAdapter, type SwitchDialog } from "./NetworkSwitchEditor";
import "./NetworkInventory.css";

type HostNetworkAdapterInfo = {
  name: string;
  interface_description: string;
  mac_address: string;
  ip_addresses: string[];
  status: string;
};

type SwitchVmAdapterInfo = {
  vm_id: string;
  vm_name: string;
  vm_state: string;
  adapter_name: string;
  mac_address: string;
  ip_addresses: string[];
};

type SwitchInfo = {
  id: string;
  name: string;
  switch_type: "External" | "Internal" | "Private";
  external_adapter_description: string | null;
  host_adapters: HostNetworkAdapterInfo[];
  vm_adapters: SwitchVmAdapterInfo[];
  is_system_managed: boolean;
  can_delete: boolean;
  delete_reason: string | null;
  can_configure_host_ipv4: boolean;
  host_ipv4_reason: string | null;
};

type NetworkInventoryData = { switches: SwitchInfo[]; physical_adapters: PhysicalNetworkAdapter[]; warnings: string[] };

const switchLabels: Record<string, string> = {
  External: "外部",
  Internal: "内部（ホスト・VM間）",
  Private: "プライベート（VM間）",
};

const switchDescriptions: Record<string, string> = {
  External: "物理ネットワークにつながる仮想スイッチです。",
  Internal: "ホストと、同じスイッチに接続したVM間のネットワークです。",
  Private: "同じスイッチに接続したVM間のネットワークです。ホスト側アダプターはありません。",
};

function NetworkIcon({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="6" rx="1" /><rect x="2" y="16" width="6" height="6" rx="1" /><rect x="16" y="16" width="6" height="6" rx="1" /><path d="M12 8v4M5 16v-4h14v4" /></svg>;
}

function RefreshIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.8 9A7 7 0 0 1 18 7l2 5M4 12l2 5a7 7 0 0 0 12.2-2" /></svg>;
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "ネットワーク情報を取得できませんでした。接続と権限を確認し、再取得してください。";
}

function formatMac(value: string): string {
  const digits = value.replace(/[:-]/g, "");
  return /^[a-f0-9]{12}$/i.test(digits) ? digits.match(/.{2}/g)!.join(":").toUpperCase() : value || "未取得";
}

function stateLabel(value: string): string {
  const labels: Record<string, string> = { running: "実行中", off: "停止中", saved: "保存済み", paused: "一時停止", starting: "起動中", stopping: "停止処理中" };
  return labels[value.toLowerCase()] || value || "未取得";
}

function Addresses({ values, guest = false }: { values: string[]; guest?: boolean }) {
  const addresses = [...new Set(values.filter(Boolean))];
  return addresses.length ? <ul className="ni-addresses">{addresses.map((address) => <li key={address}><code>{address}</code></li>)}</ul> : <span className="ni-unavailable">{guest ? "未取得（停止中・統合サービスなど）" : "未取得・未設定"}</span>;
}

export default function NetworkInventory({ disabled = false, canManage = false, onBusyChange, onChanged }: {
  disabled?: boolean;
  canManage?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onChanged?: () => void | Promise<void>;
}) {
  const [inventory, setInventory] = useState<NetworkInventoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [dialog, setDialog] = useState<SwitchDialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestSerial = useRef(0);
  const requestBusy = useRef(false);

  async function load() {
    const serial = ++requestSerial.current;
    requestBusy.current = true;
    setLoading(true);
    setError(null);
    // A failed refresh must not leave old addresses looking current.
    setInventory(null);
    setLoadedAt(null);
    try {
      const result = await invoke<NetworkInventoryData>("get_network_inventory");
      if (serial !== requestSerial.current) return;
      setInventory({ ...result, switches: [...result.switches].sort((a, b) => a.name.localeCompare(b.name, "ja")) });
      setLoadedAt(new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch (cause) {
      if (serial === requestSerial.current) setError(errorMessage(cause));
    } finally {
      if (serial === requestSerial.current) { requestBusy.current = false; setLoading(false); }
    }
  }

  useEffect(() => {
    void load();
    return () => { requestSerial.current += 1; requestBusy.current = false; };
  }, []);

  const dialogOpen = dialog !== null;
  useEffect(() => {
    onBusyChange?.(dialogOpen);
    return () => onBusyChange?.(false);
  }, [dialogOpen, onBusyChange]);

  function openDialog(value: SwitchDialog) {
    if (disabled || loading || !canManage || dialog) return;
    setNotice(null);
    onBusyChange?.(true);
    setDialog(value);
  }

  function closeDialog() {
    onBusyChange?.(false);
    setDialog(null);
  }

  async function changed(resultNotice: string) {
    setNotice(resultNotice);
    try { await onChanged?.(); }
    catch (cause) { setNotice(`${resultNotice} ホスト情報の再取得に失敗しました: ${errorMessage(cause)}`); }
    await load();
    closeDialog();
  }

  return <><div className="ni-page" inert={dialogOpen}>
    <header className="topbar">
      <div className="topbar-heading"><h1 id="network-inventory-title">ネットワーク</h1><span className="heading-count">{inventory ? `${inventory.switches.length} スイッチ` : "—"}</span></div>
      <div className="topbar-actions"><button className="secondary-button ni-refresh" type="button" disabled={disabled || loading} onClick={() => { if (!disabled && !requestBusy.current) void load(); }}><RefreshIcon />{loading ? "取得中…" : "再取得"}</button><button className="primary-button" type="button" disabled={disabled || loading || !canManage || !inventory} onClick={() => openDialog({ mode: "create" })}>＋ スイッチを作成</button></div>
    </header>
    <div className="workspace-body ni-body" aria-labelledby="network-inventory-title" aria-busy={loading}>
      <div className="ni-intro"><p>仮想スイッチと、接続先のNIC・IPアドレスを管理できます。</p><span>{loadedAt ? `${loadedAt} 取得` : ""}</span></div>
      {notice && <p className="ni-notice" role="status">{notice}</p>}
      {loading ? <div className="empty-state ni-empty" role="status"><NetworkIcon size={23} /><strong>ネットワーク情報を取得しています</strong><p>ホストとVMのアダプターを確認中です。</p></div> : error ? <div className="ni-error" role="alert"><strong>ネットワーク情報を表示できません</strong><p>{error}</p><button className="secondary-button" type="button" disabled={disabled} onClick={() => { if (!disabled && !requestBusy.current) void load(); }}>もう一度取得</button></div> : inventory && <>
        {inventory.warnings.length > 0 && <section className="ni-warnings" aria-label="取得時の注意" role="status"><strong>一部の情報を取得できませんでした</strong><ul>{inventory.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul></section>}
        <div className="ni-legend"><span><strong>内部</strong>：ホスト・VM間</span><span><strong>プライベート</strong>：VM間のみ</span><span>内部スイッチでも、NATなどの構成で外部につながる場合があります。</span></div>
        {inventory.switches.length === 0 ? <div className="empty-state ni-empty"><NetworkIcon size={23} /><strong>仮想スイッチは見つかりませんでした</strong><p>Hyper-Vに登録されているスイッチを表示します。</p></div> : <div className="ni-switches">{inventory.switches.map((networkSwitch) => <section className="ni-switch" key={networkSwitch.id} aria-labelledby={`network-switch-${networkSwitch.id}`}>
          <div className="ni-switch-heading"><div className="ni-switch-title-row"><div className="ni-switch-name"><NetworkIcon size={17} /><h2 id={`network-switch-${networkSwitch.id}`}>{networkSwitch.name}</h2><span className="ni-switch-type">{switchLabels[networkSwitch.switch_type] || networkSwitch.switch_type}</span>{networkSwitch.is_system_managed && <span className="ni-managed">Windows管理</span>}</div><div className="ni-switch-actions">{networkSwitch.switch_type === "Internal" && <button className="secondary-button" type="button" title={networkSwitch.host_ipv4_reason ?? undefined} disabled={disabled || !canManage || !networkSwitch.can_configure_host_ipv4} onClick={() => openDialog({ mode: "ipv4", switchId: networkSwitch.id, switchName: networkSwitch.name })}>ホスト側IPv4</button>}<button className="text-button ni-delete" type="button" title={networkSwitch.delete_reason ?? undefined} disabled={disabled || !canManage || !networkSwitch.can_delete} onClick={() => openDialog({ mode: "delete", switchId: networkSwitch.id, switchName: networkSwitch.name })}>削除</button></div></div><p>{switchDescriptions[networkSwitch.switch_type] || "仮想スイッチの接続情報です。"}</p>{networkSwitch.external_adapter_description && <p className="ni-physical-adapter">物理アダプター：{networkSwitch.external_adapter_description}</p>}{networkSwitch.is_system_managed ? <p className="ni-protection">Windowsが管理するスイッチのため、削除・ホスト側IPv4の変更はできません。</p> : <>{!networkSwitch.can_delete && networkSwitch.delete_reason && <p className="ni-protection">削除不可：{networkSwitch.delete_reason}</p>}{networkSwitch.switch_type === "Internal" && !networkSwitch.can_configure_host_ipv4 && networkSwitch.host_ipv4_reason && <p className="ni-protection">IPv4変更不可：{networkSwitch.host_ipv4_reason}</p>}</>}</div>
          <div className="ni-adapter-section"><h3>ホスト側</h3>{networkSwitch.host_adapters.length === 0 ? <p className="ni-empty-adapters">{networkSwitch.switch_type === "Private" ? "プライベートスイッチには、ホスト側アダプターがありません。" : "ホスト側アダプターは見つかりませんでした。"}</p> : <div className="ni-table-scroll"><table className="ni-table ni-host-table"><caption className="ni-sr-only">{networkSwitch.name} のホスト側アダプター</caption><thead><tr><th scope="col">アダプター</th><th scope="col">MACアドレス</th><th scope="col">IPアドレス / プレフィックス長</th></tr></thead><tbody>{networkSwitch.host_adapters.map((adapter, index) => <tr key={`${adapter.name}-${index}`}><td><strong>{adapter.name}</strong><small>{adapter.interface_description}</small>{adapter.status && <span className="ni-adapter-status">{adapter.status}</span>}</td><td><code>{formatMac(adapter.mac_address)}</code></td><td><Addresses values={adapter.ip_addresses} /></td></tr>)}</tbody></table></div>}</div>
          <div className="ni-adapter-section"><div className="ni-subheading"><h3>接続中のVM</h3><span>{new Set(networkSwitch.vm_adapters.map((adapter) => adapter.vm_id)).size} 台 · {networkSwitch.vm_adapters.length} NIC</span></div>{networkSwitch.vm_adapters.length === 0 ? <p className="ni-empty-adapters">このスイッチに接続されたVMのNICはありません。</p> : <div className="ni-table-scroll"><table className="ni-table ni-vm-table"><caption className="ni-sr-only">{networkSwitch.name} に接続されたVMのNIC</caption><thead><tr><th scope="col">VM / NIC</th><th scope="col">MACアドレス</th><th scope="col">IPアドレス</th></tr></thead><tbody>{networkSwitch.vm_adapters.map((adapter, index) => <tr key={`${adapter.vm_id}-${adapter.adapter_name}-${index}`}><td><strong>{adapter.vm_name}</strong><small>{adapter.adapter_name} · {stateLabel(adapter.vm_state)}</small></td><td><code>{formatMac(adapter.mac_address)}</code></td><td><Addresses values={adapter.ip_addresses} guest /></td></tr>)}</tbody></table></div>}</div>
        </section>)}</div>}
        <p className="ni-footnote">VM側IPはHyper-Vから取得できた値です。停止中や統合サービスの状態によって未取得・古い値の場合があります。表示がない場合も、IPアドレスが未設定とは限りません。DHCP・NATの設定や通信可否は、この一覧では確認しません。</p>
      </>}
    </div>
    </div>{dialog && <NetworkSwitchEditor key={dialog.mode === "create" ? "create" : `${dialog.mode}-${dialog.switchId}`} dialog={dialog} physicalAdapters={inventory?.physical_adapters ?? []} canManage={canManage} onClose={closeDialog} onSuccess={changed} />}
  </>;
}
