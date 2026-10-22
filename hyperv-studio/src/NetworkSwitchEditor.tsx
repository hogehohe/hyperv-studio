import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import "./NetworkSwitchEditor.css";

export type PhysicalNetworkAdapter = {
  interface_guid: string;
  name: string;
  interface_description: string;
  mac_address: string;
  status: string;
  available: boolean;
  unavailable_reason: string | null;
};

export type SwitchChangeInfo = {
  switch_id: string;
  name: string;
  switch_type: string;
  revision: string;
  is_system_managed: boolean;
  can_delete: boolean;
  delete_reason: string | null;
  can_configure_host_ipv4: boolean;
  host_ipv4_reason: string | null;
  vm_adapter_count: number;
  host_adapters: { name: string; interface_guid: string; interface_index: number; mac_address: string; ip_addresses: string[]; dhcp: string; status: string }[];
  host_ipv4: {
    interface_guid: string;
    interface_index: number;
    interface_name: string;
    dhcp: string;
    addresses: { ip_address: string; prefix_length: number }[];
    has_default_gateway: boolean;
  } | null;
};

export type SwitchDialog = { mode: "create" } | { mode: "delete" | "ipv4"; switchId: string; switchName: string };

function message(error: unknown): string {
  return typeof error === "string" ? error : error instanceof Error ? error.message : "操作を完了できませんでした。現在の状態を再取得して確認してください。";
}

function validIpv4(address: string, prefix: string): boolean {
  const fields = address.split(".");
  if (fields.length !== 4 || fields.some((field) => !/^(0|[1-9][0-9]{0,2})$/.test(field) || Number(field) > 255)) return false;
  if (!/^[1-9][0-9]?$/.test(prefix) || Number(prefix) > 30) return false;
  const octets = fields.map(Number);
  const numeric = octets.reduce((result, octet) => result * 256 + octet, 0);
  const subnetSize = 2 ** (32 - Number(prefix));
  const hostPart = numeric % subnetSize;
  return octets[0] > 0 && octets[0] !== 127 && octets[0] < 224 && hostPart !== 0 && hostPart !== subnetSize - 1;
}

const kinds = [
  { value: "Internal", label: "内部（ホスト・VM間）", description: "ホスト側アダプターを持つスイッチを作成します。作成後にホスト側IPv4を設定できます。" },
  { value: "Private", label: "プライベート（VM間のみ）", description: "同じスイッチにつないだVM間で使います。ホスト側アダプターは作成しません。" },
  { value: "External", label: "外部（物理ネットワーク）", description: "選択した物理アダプターを仮想スイッチに割り当てます。作成中にホストの接続が一時的に切れる場合があります。" },
];

export default function NetworkSwitchEditor({ dialog, physicalAdapters, canManage, onClose, onSuccess }: {
  dialog: SwitchDialog;
  physicalAdapters: PhysicalNetworkAdapter[];
  canManage: boolean;
  onClose: () => void;
  onSuccess: (notice: string) => Promise<void>;
}) {
  const [info, setInfo] = useState<SwitchChangeInfo | null>(null);
  const [loading, setLoading] = useState(dialog.mode !== "create");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState(false);
  const [name, setName] = useState("");
  const [switchType, setSwitchType] = useState("Internal");
  const [physicalGuid, setPhysicalGuid] = useState("");
  const [allowManagement, setAllowManagement] = useState(true);
  const [externalConfirmed, setExternalConfirmed] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [ipAddress, setIpAddress] = useState("");
  const [prefix, setPrefix] = useState("24");
  const [createStep, setCreateStep] = useState<"form" | "review">("form");
  const requestSerial = useRef(0);
  const savingRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  async function loadInfo() {
    if (dialog.mode === "create" || savingRef.current) return;
    const serial = ++requestSerial.current;
    setLoading(true);
    setInfo(null);
    setError(null);
    setMutationError(false);
    setConfirmation("");
    try {
      const value = await invoke<SwitchChangeInfo>("get_network_switch_change_info", { switchId: dialog.switchId });
      if (serial !== requestSerial.current) return;
      setInfo(value);
      setIpAddress(value.host_ipv4?.addresses[0]?.ip_address ?? "");
      setPrefix(String(value.host_ipv4?.addresses[0]?.prefix_length ?? 24));
    } catch (cause) {
      if (serial === requestSerial.current) setError(message(cause));
    } finally {
      if (serial === requestSerial.current) setLoading(false);
    }
  }

  useEffect(() => {
    void loadInfo();
    dialogRef.current?.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!savingRef.current) closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]') ?? []).filter((control) => control.offsetParent !== null);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); dialogRef.current?.focus(); return; }
      if (!dialogRef.current?.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      requestSerial.current += 1;
      document.removeEventListener("keydown", onKey);
      const target = returnFocus.current;
      requestAnimationFrame(() => { if (target?.isConnected && !target.closest("[inert]")) target.focus(); });
    };
    // The parent keys each dialog. Capture the original focus and target once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const physical = physicalAdapters.find((adapter) => adapter.interface_guid === physicalGuid && adapter.available);
  const validName = name.trim().length > 0 && name.trim().length <= 100 && !/[\x00-\x1f]/.test(name);
  const validCreate = validName && (switchType !== "External" || (physical && externalConfirmed));
  const exactName = info !== null && confirmation === info.name;
  const allowed = dialog.mode === "delete" ? info?.can_delete === true : info?.can_configure_host_ipv4 === true && info.host_ipv4 !== null && !info.host_ipv4.has_default_gateway;
  const blockReason = dialog.mode === "delete" ? info?.delete_reason : info?.host_ipv4_reason;
  const canSubmit = canManage && !loading && !saving && (dialog.mode === "create" ? validCreate && createStep === "review" : allowed && exactName && (dialog.mode === "delete" || validIpv4(ipAddress, prefix)));
  const title = dialog.mode === "create" ? "仮想スイッチを作成" : dialog.mode === "delete" ? "仮想スイッチを削除" : "ホスト側IPv4を設定";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (savingRef.current || !canManage || loading || saving) return;
    if (dialog.mode === "create" && createStep === "form") {
      if (validCreate) { setCreateStep("review"); setError(null); }
      return;
    }
    if (!canSubmit) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setMutationError(false);
    let notice: string;
    try {
      if (dialog.mode === "create") {
        await invoke("create_network_switch", { request: { name: name.trim(), switch_type: switchType, physical_adapter_guid: switchType === "External" ? physicalGuid : null, allow_management_os: switchType === "External" ? allowManagement : true, external_impact_confirmed: switchType === "External" && externalConfirmed } });
        notice = `仮想スイッチ「${name.trim()}」を作成しました。`;
      } else if (info && dialog.mode === "delete") {
        await invoke("delete_network_switch", { request: { switch_id: info.switch_id, expected_revision: info.revision, confirmation_name: confirmation } });
        notice = `仮想スイッチ「${info.name}」を削除しました。`;
      } else if (info && dialog.mode === "ipv4") {
        await invoke("save_host_network_ipv4", { request: { switch_id: info.switch_id, expected_revision: info.revision, confirmation_name: confirmation, ip_address: ipAddress, prefix_length: Number(prefix) } });
        notice = `「${info.name}」のホスト側IPv4を保存しました。`;
      } else return;
    } catch (cause) {
      setError(message(cause));
      setMutationError(true);
      // A rejected revision or a partially applied native operation needs a fresh review.
      if (dialog.mode !== "create") { setInfo(null); setConfirmation(""); }
      savingRef.current = false;
      setSaving(false);
      return;
    }
    try { await onSuccess(notice); }
    finally { savingRef.current = false; setSaving(false); }
  }

  return createPortal(<div className="modal-backdrop ns-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingRef.current) onClose(); }}>
    <div ref={dialogRef} className="modal ns-modal" role="dialog" aria-modal="true" aria-labelledby="network-switch-dialog-title" aria-describedby="network-switch-dialog-description" aria-busy={loading || saving} tabIndex={-1}>
      <div className="modal-header"><div><h2 id="network-switch-dialog-title">{title}</h2><p id="network-switch-dialog-description">{dialog.mode === "create" ? "このPCのHyper-Vに新しいスイッチを作成します。" : info?.name ?? dialog.switchName}</p></div><button className="icon-button" type="button" data-initial-focus aria-label={`${title}を閉じる`} disabled={saving} onClick={onClose}>×</button></div>
      <form onSubmit={(event) => { void submit(event); }}>
        <div className="modal-body">
          {dialog.mode === "create" ? createStep === "form" ? <>
            <div className="form-field"><label htmlFor="new-switch-name">スイッチ名 <span className="required">*</span></label><input id="new-switch-name" value={name} maxLength={100} disabled={saving} onChange={(event) => setName(event.target.value)} placeholder="例: Host-only Lab" autoComplete="off" /></div>
            <div className="form-field"><label htmlFor="new-switch-kind">接続の種類</label><select id="new-switch-kind" value={switchType} disabled={saving} onChange={(event) => { setSwitchType(event.target.value); setExternalConfirmed(false); }} >{kinds.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select><small>{kinds.find((kind) => kind.value === switchType)?.description}</small></div>
            {switchType === "External" && <>
              <div className="form-field"><label htmlFor="new-switch-physical">物理アダプター <span className="required">*</span></label><select id="new-switch-physical" value={physicalGuid} disabled={saving} onChange={(event) => { setPhysicalGuid(event.target.value); setExternalConfirmed(false); }}><option value="">物理アダプターを選択</option>{physicalAdapters.map((adapter) => <option key={adapter.interface_guid} value={adapter.interface_guid} disabled={!adapter.available}>{adapter.name} · {adapter.interface_description}{!adapter.available ? `（${adapter.unavailable_reason || "使用できません"}）` : ""}</option>)}</select>{physicalAdapters.every((adapter) => !adapter.available) && <small>使用できる物理アダプターはありません。ネットワーク画面を再取得してください。</small>}{physical && <small>状態: {physical.status || "未取得"} · MAC: {physical.mac_address || "未取得"}</small>}</div>
              <label className="ns-check"><input type="checkbox" checked={allowManagement} disabled={saving} onChange={(event) => { setAllowManagement(event.target.checked); setExternalConfirmed(false); }} /><span>ホストOSと物理アダプターを共有する<small>オフにすると、このアダプターを使ったホストの通信が利用できなくなります。</small></span></label>
              <div className="ns-warning"><strong>ホストの接続に影響します</strong><p>物理アダプターの割り当てを変更します。リモート接続中は、このPCへの接続が切れる場合があります。</p><label className="ns-check"><input type="checkbox" checked={externalConfirmed} disabled={saving} onChange={(event) => setExternalConfirmed(event.target.checked)} /><span>選択した物理アダプターと接続への影響を確認した</span></label></div>
            </>}
            <p className="ns-note">VMのNICは自動接続しません。DHCPサーバー・NAT・DNS・ゲートウェイは作成しません。</p>
          </> : <>
            <p className="ns-description">次の構成で仮想スイッチを作成します。</p>
            <dl className="ns-review"><div><dt>名前</dt><dd>{name.trim()}</dd></div><div><dt>種類</dt><dd>{kinds.find((kind) => kind.value === switchType)?.label}</dd></div>{switchType === "External" && <><div><dt>物理アダプター</dt><dd>{physical?.name}<small>{physical?.interface_description}</small></dd></div><div><dt>ホストと共有</dt><dd>{allowManagement ? "共有する" : "共有しない"}</dd></div></>}</dl>
            {switchType === "External" && <p className="ns-warning">作成中にホストの接続が一時的に切れる場合があります。{!allowManagement && "このアダプターを使ったホストの通信は利用できなくなります。"}</p>}
            {switchType === "Internal" && <p className="ns-note">作成後、この画面からホスト側IPv4を設定できます。</p>}
          </> : loading ? <p className="network-loading" role="status"><span className="loading-spinner" />現在の接続と設定を確認しています…</p> : info ? <>
            {dialog.mode === "delete" ? <>
              <p className="ns-description">仮想スイッチと、そのホスト側仮想アダプターを削除します。ホスト側アダプターのIP設定も失われます。</p>
              <dl className="ns-review"><div><dt>スイッチ</dt><dd>{info.name}</dd></div><div><dt>接続されたVM NIC</dt><dd>{info.vm_adapter_count} NIC</dd></div>{info.host_adapters.map((adapter) => <div key={adapter.interface_guid}><dt>ホスト側</dt><dd>{adapter.name}<small>{adapter.ip_addresses.join(" · ") || "IP未取得・未設定"}</small></dd></div>)}</dl>
              {info.switch_type === "External" && <p className="ns-warning">物理アダプターの割り当てが解除されます。ホストのネットワーク接続が一時的に切れる場合があります。</p>}
            </> : <>
              <p className="ns-description">内部スイッチのホスト側アダプターに、固定IPv4を1つ設定します。</p>
              {info.host_ipv4 && <dl className="ns-review"><div><dt>アダプター</dt><dd>{info.host_ipv4.interface_name}</dd></div><div><dt>現在のDHCP</dt><dd>{info.host_ipv4.dhcp}</dd></div><div><dt>現在のIPv4</dt><dd>{info.host_ipv4.addresses.length ? info.host_ipv4.addresses.map((address) => <code key={`${address.ip_address}/${address.prefix_length}`}>{address.ip_address}/{address.prefix_length}</code>) : "未設定"}</dd></div></dl>}
              {allowed && <><div className="ns-ip-fields"><div className="form-field"><label htmlFor="switch-host-ipv4">IPv4アドレス</label><input id="switch-host-ipv4" value={ipAddress} disabled={saving} onChange={(event) => setIpAddress(event.target.value)} placeholder="例: 192.168.100.1" inputMode="decimal" autoComplete="off" /></div><div className="form-field"><label htmlFor="switch-host-prefix">プレフィックス長</label><input id="switch-host-prefix" type="number" min={1} max={30} value={prefix} disabled={saving} onChange={(event) => setPrefix(event.target.value)} /><small>1～30（例: 24）</small></div></div><p className="ns-warning">このアダプターのDHCPを無効にし、既存のIPv4を入力した1つに置き換えます。VM側のIP設定は変更しません。</p><p className="ns-note">DHCPサーバー・NAT・DNS・ゲートウェイは設定しません。IPv6は変更しません。VM側にも同じネットワークのIP設定が必要です。</p></>}
            </>}
            {!allowed && <p className="ns-blocked" role="status">{blockReason || (info.is_system_managed ? "Windowsが管理するスイッチのため、この操作はできません。" : "現在の構成では、この操作はできません。")}</p>}
            {allowed && <div className="form-field ns-confirmation"><label htmlFor="switch-confirmation">確認のため、スイッチ名を入力 <span className="required">*</span></label><input id="switch-confirmation" value={confirmation} disabled={saving} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} /><small>「{info.name}」を完全に一致させてください。</small></div>}
          </> : <p className="ns-description">現在の構成を取得してから操作してください。</p>}
          {error && <div className="form-errors" role="alert"><p>{error}</p>{mutationError && dialog.mode !== "create" && <p>変更が一部反映されている場合があります。再取得して、現在の構成を確認してください。</p>}</div>}
          {saving && <p className="ns-saving" role="status">{dialog.mode === "create" ? "作成しています…" : dialog.mode === "delete" ? "削除しています…" : "IPv4を設定しています…"} 完了までこの画面を閉じないでください。</p>}
        </div>
        <div className="modal-footer ns-footer">{dialog.mode !== "create" && <button className="text-button ns-reload" type="button" disabled={loading || saving} onClick={() => { void loadInfo(); }}>再取得</button>}<div>{dialog.mode === "create" && createStep === "review" && <button className="secondary-button" type="button" disabled={saving} onClick={() => setCreateStep("form")}>戻る</button>}<button className="secondary-button" type="button" disabled={saving} onClick={onClose}>{info && !allowed && dialog.mode !== "create" ? "閉じる" : "キャンセル"}</button>{(dialog.mode === "create" || !info || allowed) && <button className={`primary-button ${dialog.mode === "delete" ? "danger-confirm-button" : ""}`} type="submit" disabled={dialog.mode === "create" && createStep === "form" ? !canManage || saving || !validCreate : !canSubmit}>{saving ? "処理中…" : dialog.mode === "create" ? createStep === "form" ? "確認へ" : "作成" : dialog.mode === "delete" ? "スイッチを削除" : "IPv4を保存"}</button>}</div></div>
      </form>
    </div>
  </div>, document.body);
}
