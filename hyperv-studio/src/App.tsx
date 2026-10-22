import { useEffect, useMemo, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { useAppearance, type ThemePreference } from "./useAppearance";
import { useIsoLibrary, formatIsoSize, type IsoImage } from "./useIsoLibrary";
import IsoLibrarySettings, { osFamilyLabel } from "./IsoLibrarySettings";
import NetworkAdaptersEditor, { newNetworkAdapter, networkAdapterDrafts, type NetworkAdapterDraft, type VmNetworkAdapter } from "./NetworkAdaptersEditor";
import BootSettingsEditor, { type VmBootEntry, type VmBootSettings } from "./BootSettingsEditor";
import NetworkInventory from "./NetworkInventory";
import prepareLinuxTemplate from "../src-tauri/scripts/prepare-linux-template.sh?raw";
import "./App.css";

type HostStatus = {
  computer_name: string;
  can_manage: boolean;
  error?: string;
  default_vm_path?: string;
  default_vhd_path?: string;
  switches: string[];
};

type VmInfo = {
  id: string;
  name: string;
  state: string;
  generation: number;
  memory_startup_bytes: number;
  memory_assigned_bytes: number;
  processor_count: number;
  uptime_seconds: number;
};

type VmDeleteInfo = { id: string; name: string; state: string; disk_paths: string[]; can_delete_disks: boolean; disk_delete_reason: string | null; has_checkpoints: boolean };
type VmDeleteResult = { id: string; deleted_disk_paths: string[]; retained_disk_paths: string[]; warning: string | null };
type VmTemplate = { vm_id: string; registered_name: string; registered_at: number };
type TemplateAction = { id: string; name: string; mode: "register" | "unregister"; missing?: boolean };

type Draft = {
  name: string;
  generation: "1" | "2";
  memory: string;
  disk: string;
  cpu: string;
  networkAdapters: NetworkAdapterDraft[];
  isoId: string;
};

type CloneProgress = { phase: string; message: string };

type IconName = "grid" | "server" | "plus" | "copy" | "edit" | "refresh" | "search" | "play" | "power" | "cpu" | "memory" | "disk" | "clock" | "network" | "chevron" | "close" | "check" | "alert" | "info" | "settings" | "sun" | "moon" | "monitor" | "shield";

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.65, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  switch (name) {
    case "grid": return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>;
    case "server": return <svg {...common}><rect x="3" y="3" width="18" height="7" rx="2" /><rect x="3" y="14" width="18" height="7" rx="2" /><path d="M7 6.5h.01M7 17.5h.01M11 6.5h7M11 17.5h7" /></svg>;
    case "plus": return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case "copy": return <svg {...common}><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></svg>;
    case "shield": return <svg {...common}><path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3Z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg>;
    case "edit": return <svg {...common}><path d="m15 4 5 5M4 20l5-1L21 7a2.1 2.1 0 0 0-3-3L6 16l-2 4Z" /></svg>;
    case "refresh": return <svg {...common}><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.8 9A7 7 0 0 1 18 7l2 5M4 12l2 5a7 7 0 0 0 12.2-2" /></svg>;
    case "search": return <svg {...common}><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></svg>;
    case "play": return <svg {...common}><path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="none" /></svg>;
    case "power": return <svg {...common}><path d="M12 3v9" /><path d="M7.1 5.6a8 8 0 1 0 9.8 0" /></svg>;
    case "cpu": return <svg {...common}><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 9h6v6H9zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></svg>;
    case "memory": return <svg {...common}><rect x="3" y="7" width="18" height="10" rx="2" /><path d="M7 10v4M11 10v4M15 10v4M5 17v3M9 17v3M15 17v3M19 17v3" /></svg>;
    case "disk": return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 14h18M7 16.5h.01M11 16.5h.01" /></svg>;
    case "clock": return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case "network": return <svg {...common}><rect x="9" y="2" width="6" height="6" rx="1" /><rect x="2" y="16" width="6" height="6" rx="1" /><rect x="16" y="16" width="6" height="6" rx="1" /><path d="M12 8v4M5 16v-4h14v4" /></svg>;
    case "chevron": return <svg {...common}><path d="m9 6 6 6-6 6" /></svg>;
    case "close": return <svg {...common}><path d="M5 5 19 19M19 5 5 19" /></svg>;
    case "check": return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
    case "alert": return <svg {...common}><path d="M12 3 2.8 19a1.3 1.3 0 0 0 1.1 2h16.2a1.3 1.3 0 0 0 1.1-2L12 3Z" /><path d="M12 9v5M12 17h.01" /></svg>;
    case "info": return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>;
    case "settings": return <svg {...common}><path d="m9.4 3-.7 2.3-2.4 1.4L4 6.1l-2 3.5 1.6 1.7v2.8L2 15.8l2 3.5 2.3-.6 2.4 1.4.7 2.3h4.1l.7-2.3 2.4-1.4 2.3.6 2-3.5-1.6-1.7v-2.8L21 9.6l-2-3.5-2.3.6-2.4-1.4L13.6 3Z" transform="translate(.5 -1) scale(.96)" /><circle cx="12" cy="12" r="3" /></svg>;
    case "sun": return <svg {...common}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" /></svg>;
    case "moon": return <svg {...common}><path d="M20.5 13.2A8.5 8.5 0 0 1 10.8 3 8.5 8.5 0 1 0 20.5 13.2Z" /></svg>;
    case "monitor": return <svg {...common}><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>;
  }
}

function blankDraft(): Draft { return { name: "", generation: "2", memory: "8192", disk: "200", cpu: "2", networkAdapters: [newNetworkAdapter()], isoId: "" }; }
const newVmBasePath = "C:\\Virtual Machines";
const newVmVersion = "12.0";
const themeOptions: { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: "light", label: "ライト", icon: "sun" },
  { value: "dark", label: "ダーク", icon: "moon" },
  { value: "system", label: "システムに合わせる", icon: "monitor" },
];
const templateDownloadUrl = `data:text/x-shellscript;charset=utf-8,${encodeURIComponent(prepareLinuxTemplate)}`;

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "処理に失敗しました。ホストの状態を確認して、もう一度お試しください。";
}

function stateKind(state: string): "running" | "off" | "other" {
  const value = state.toLowerCase();
  if (value === "running") return "running";
  if (value === "off") return "off";
  return "other";
}

function stateLabel(state: string): string {
  const labels: Record<string, string> = { running: "実行中", off: "停止中", saved: "保存済み", paused: "一時停止", starting: "起動中", stopping: "停止処理中", saving: "保存中", pausing: "一時停止中", resuming: "再開中", resetting: "再起動中", critical: "要確認" };
  return labels[state.toLowerCase()] ?? state;
}

function formatMemory(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${Number(gb.toFixed(1))} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const minutes = Math.floor(seconds / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days} 日 ${hours} 時間`;
  if (hours > 0) return `${hours} 時間 ${minutes % 60} 分`;
  return `${minutes} 分`;
}

function integerInRange(value: string, min: number, max: number): boolean {
  return /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max;
}

function validateName(value: string, vms: VmInfo[]): string | null {
  const name = value.trim();
  if (!name) return "仮想マシン名を入力してください。";
  if (name.length > 64) return "仮想マシン名は 64 文字以内にしてください。";
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)) return "仮想マシン名にファイル名で使えない文字を含めることはできません。";
  if (vms.some((vm) => vm.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return "同じ名前の仮想マシンが既にあります。";
  return null;
}

function suggestCloneName(source: VmInfo, vms: VmInfo[]): string {
  const names = new Set(vms.map((vm) => vm.name.toLocaleLowerCase()));
  for (let index = 1; ; index += 1) {
    const suffix = index === 1 ? "-copy" : `-copy-${index}`;
    const name = `${source.name.slice(0, 64 - suffix.length)}${suffix}`;
    if (!names.has(name.toLocaleLowerCase())) return name;
  }
}

function suggestGuestHostname(vmName: string): string {
  return vmName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 63).replace(/-+$/g, "") || "vm-copy";
}

function validateGuestHostname(value: string): string | null {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)) {
    return "OSのホスト名は1〜63文字の小文字英数字とハイフンで指定し、先頭・末尾は英数字にしてください。";
  }
  return null;
}

function validateDraft(draft: Draft, vms: VmInfo[], images: IsoImage[]): string[] {
  const nameIssue = validateName(draft.name, vms);
  const issues: string[] = nameIssue ? [nameIssue] : [];
  if (!integerInRange(draft.memory, 512, 131072)) issues.push("起動メモリは 512～131,072 MB の整数で指定してください。");
  if (!integerInRange(draft.disk, 8, 2048)) issues.push("仮想ディスクは 8～2,048 GiB の整数で指定してください。");
  if (!integerInRange(draft.cpu, 1, 64)) issues.push("プロセッサは 1～64 個の整数で指定してください。");
  if (draft.networkAdapters.length > 8) issues.push("NICは8個以内にしてください。");
  if (draft.isoId && !images.some((image) => image.id === draft.isoId && image.available)) issues.push("選択したOSのISOが見つかりません。設定のOSイメージを確認してください。");
  return issues;
}

function App() {
  const appearance = useAppearance();
  const isoLibrary = useIsoLibrary();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"appearance" | "images">("appearance");
  const [host, setHost] = useState<HostStatus | null>(null);
  const [hostError, setHostError] = useState<string | null>(null);
  const [vms, setVms] = useState<VmInfo[]>([]);
  const [templates, setTemplates] = useState<VmTemplate[]>([]);
  const [templatesKnown, setTemplatesKnown] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [vmSection, setVmSection] = useState<"vms" | "templates" | "network">("vms");
  const [templateAction, setTemplateAction] = useState<TemplateAction | null>(null);
  const [templateConfirmation, setTemplateConfirmation] = useState("");
  const [templateActionError, setTemplateActionError] = useState<string | null>(null);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "running" | "off">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [shutdownVm, setShutdownVm] = useState<VmInfo | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState<"form" | "review">("form");
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [cloneSource, setCloneSource] = useState<VmInfo | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [cloneConnectNetwork, setCloneConnectNetwork] = useState(true);
  const [cloneConfigureGuest, setCloneConfigureGuest] = useState(true);
  const [cloneHostname, setCloneHostname] = useState("");
  const [cloneHostnameEdited, setCloneHostnameEdited] = useState(false);
  const [cloneTemplateReady, setCloneTemplateReady] = useState(false);
  const [cloneNameError, setCloneNameError] = useState<string | null>(null);
  const [cloneGuestError, setCloneGuestError] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);
  const [cloneProgress, setCloneProgress] = useState<CloneProgress | null>(null);
  const [networkVm, setNetworkVm] = useState<VmInfo | null>(null);
  const [networkAdapters, setNetworkAdapters] = useState<NetworkAdapterDraft[]>([]);
  const [networkExpectedAdapterIds, setNetworkExpectedAdapterIds] = useState<string[]>([]);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkLoaded, setNetworkLoaded] = useState(false);
  const [networkSaving, setNetworkSaving] = useState(false);
  const [networkSwitchBusy, setNetworkSwitchBusy] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [bootVm, setBootVm] = useState<VmInfo | null>(null);
  const [bootSettings, setBootSettings] = useState<VmBootSettings | null>(null);
  const [bootEntries, setBootEntries] = useState<VmBootEntry[]>([]);
  const [bootSecureBoot, setBootSecureBoot] = useState<boolean | null>(null);
  const [bootLoading, setBootLoading] = useState(false);
  const [bootSaving, setBootSaving] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const bootRequestSerial = useRef(0);
  const [renameTarget, setRenameTarget] = useState<VmInfo | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<VmInfo | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteInfo, setDeleteInfo] = useState<VmDeleteInfo | null>(null);
  const [deleteInfoLoading, setDeleteInfoLoading] = useState(false);
  const [deleteDisks, setDeleteDisks] = useState(false);
  const [deleteWarning, setDeleteWarning] = useState<{ name: string; result: VmDeleteResult; deleteDisks: boolean } | null>(null);
  const deleteRequestSerial = useRef(0);
  const deleteConfirmationRef = useRef<HTMLInputElement>(null);
  const networkRequestSerial = useRef(0);
  const requestSerial = useRef(0);
  const operationLock = useRef(false);
  const refreshCount = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const modalOpen = settingsOpen || createOpen || shutdownVm !== null || cloneSource !== null || networkVm !== null || bootVm !== null || renameTarget !== null || deleteTarget !== null || templateAction !== null;

  async function refresh() {
    refreshCount.current += 1;
    const serial = ++requestSerial.current;
    setLoading(true);
    setHostError(null);
    setListError(null);
    try {
      const [hostResult, vmResult, templateResult] = await Promise.allSettled([
        invoke<HostStatus>("get_host_status"),
        invoke<VmInfo[]>("list_vms"),
        invoke<VmTemplate[]>("list_vm_templates"),
      ]);
      if (serial !== requestSerial.current) return;
      if (hostResult.status === "fulfilled") setHost(hostResult.value);
      else { setHost(null); setHostError(errorMessage(hostResult.reason)); }
      if (vmResult.status === "fulfilled") setVms(vmResult.value);
      else setListError(errorMessage(vmResult.reason));
      if (templateResult.status === "fulfilled") { setTemplates(templateResult.value); setTemplatesKnown(true); setTemplatesError(null); }
      else { setTemplatesKnown(false); setTemplatesError(errorMessage(templateResult.reason)); }
    } finally {
      refreshCount.current -= 1;
      if (refreshCount.current === 0) setLoading(false);
    }
  }

  function requestRefresh() {
    if (operationLock.current || refreshCount.current > 0 || loading || creating || cloning || networkSaving || networkLoading || networkSwitchBusy || bootLoading || bootSaving || renaming || deleting || templateSaving || deleteInfoLoading || connectingId !== null || busyId !== null || modalOpen) return;
    void refresh();
  }

  useEffect(() => {
    void refresh();
    return () => { requestSerial.current += 1; networkRequestSerial.current += 1; bootRequestSerial.current += 1; deleteRequestSerial.current += 1; };
  }, []);

  useEffect(() => {
    if (!modalOpen) return;
    const onDialogKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (operationLock.current || creating || cloning || networkSaving || bootSaving || renaming || deleting || templateSaving || busyId || isoLibrary.busy) return;
        closeNetwork();
        closeBoot();
        setCreateOpen(false);
        setCloneSource(null);
        setShutdownVm(null);
        setSettingsOpen(false);
        setRenameTarget(null);
        setTemplateAction(null);
        closeDelete();
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex="0"]',
      ) ?? []).filter((element) => element.offsetParent !== null && !element.closest("[inert]"));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (!dialogRef.current?.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener("keydown", onDialogKey);
    return () => document.removeEventListener("keydown", onDialogKey);
  }, [modalOpen, creating, cloning, networkSaving, bootSaving, renaming, deleting, templateSaving, busyId, isoLibrary.busy]);

  useEffect(() => {
    if (!modalOpen && returnFocusRef.current?.isConnected) {
      returnFocusRef.current.focus();
      returnFocusRef.current = null;
    }
  }, [modalOpen]);

  useEffect(() => {
    if (deleteTarget && deleteInfo && !deleteInfoLoading) deleteConfirmationRef.current?.focus();
  }, [deleteTarget?.id, deleteInfo, deleteInfoLoading]);

  const templateMap = useMemo(() => new Map(templates.map((entry) => [entry.vm_id.toLowerCase(), entry])), [templates]);
  const sectionVms = useMemo(() => templatesKnown ? vms.filter((vm) => templateMap.has(vm.id.toLowerCase()) === (vmSection === "templates")) : [], [vms, templatesKnown, templateMap, vmSection]);
  const missingTemplates = useMemo(() => templatesKnown && !listError ? templates.filter((entry) => !vms.some((vm) => vm.id.toLowerCase() === entry.vm_id.toLowerCase())) : [], [templatesKnown, listError, templates, vms]);
  const visibleMissingTemplates = vmSection === "templates" && filter === "all" ? missingTemplates.filter((entry) => entry.registered_name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) : [];
  const filteredVms = useMemo(() => sectionVms.filter((vm) => {
    const matchesText = vm.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
    const matchesState = filter === "all" || stateKind(vm.state) === filter;
    return matchesText && matchesState;
  }).sort((a, b) => a.name.localeCompare(b.name, "ja")), [sectionVms, search, filter]);

  const selectedVm = filteredVms.find((vm) => vm.id === selectedId) ?? filteredVms[0] ?? null;
  const selectedIso = isoLibrary.library?.images.find((image) => image.id === draft.isoId) ?? null;
  const newVmDirectory = `${newVmBasePath}\\${draft.name.trim()}`;
  const newVmVhdPath = `${newVmDirectory}\\${draft.name.trim()}.vhdx`;
  const selectedIsTemplate = Boolean(selectedVm && templateMap.has(selectedVm.id.toLowerCase()));
  const runningCount = sectionVms.filter((vm) => stateKind(vm.state) === "running").length;
  const offCount = sectionVms.filter((vm) => stateKind(vm.state) === "off").length;
  const sectionCount = sectionVms.length + (vmSection === "templates" ? missingTemplates.length : 0);
  const countsUnavailable = !templatesKnown || Boolean(listError) || (loading && vms.length === 0);
  const hostCanManage = host?.can_manage === true;
  const canManage = hostCanManage && templatesKnown && !listError;
  const controlsBusy = loading || creating || cloning || networkLoading || networkSaving || bootLoading || bootSaving || renaming || deleting || templateSaving || deleteInfoLoading || connectingId !== null || busyId !== null || isoLibrary.busy;
  const pageControlsBusy = controlsBusy || modalOpen || networkSwitchBusy;
  const bootChanged = Boolean(bootSettings && (bootSecureBoot !== bootSettings.secure_boot_enabled || bootEntries.length !== bootSettings.boot_entries.length || bootEntries.some((entry, index) => entry.id !== bootSettings.boot_entries[index]?.id)));
  const bootCanEdit = bootSettings !== null && !isProtectedVm(bootSettings.vm_id) && stateKind(bootSettings.state) === "off" && stateKind(vms.find((vm) => vm.id === bootSettings.vm_id)?.state || "") === "off";
  const bootCanSave = bootCanEdit && bootChanged && (bootSettings?.generation !== 2 || bootSecureBoot !== null);
  const networkCanEdit = networkVm !== null && !isProtectedVm(networkVm.id) && stateKind(networkVm.state) === "off" && stateKind(vms.find((vm) => vm.id === networkVm.id)?.state || "") === "off";
  const deleteCurrentVm = deleteTarget ? vms.find((vm) => vm.id === deleteTarget.id) : null;
  const deleteCanConfirm = Boolean(deleteTarget && !isProtectedVm(deleteTarget.id) && deleteInfo && deleteConfirmation === deleteTarget.name && deleteCurrentVm && stateKind(deleteCurrentVm.state) === "off" && stateKind(deleteInfo.state) === "off" && (!deleteDisks || deleteInfo.can_delete_disks));
  const templateActionCurrentVm = templateAction ? vms.find((vm) => vm.id.toLowerCase() === templateAction.id.toLowerCase()) : null;
  const templateCanConfirm = Boolean(templateAction && templatesKnown && templateConfirmation === templateAction.name && (templateAction.mode === "register" ? templateActionCurrentVm && stateKind(templateActionCurrentVm.state) === "off" && !isProtectedVm(templateAction.id) : templateMap.has(templateAction.id.toLowerCase())));

  function isProtectedVm(id: string) { return !templatesKnown || templateMap.has(id.toLowerCase()); }

  function selectSection(section: "vms" | "templates" | "network") {
    if (operationLock.current || modalOpen || networkSwitchBusy) return;
    setVmSection(section);
    setSearch("");
    setFilter("all");
    setSelectedId(null);
  }

  function openTemplateAction(target: TemplateAction) {
    if (!canManage || pageControlsBusy || operationLock.current || refreshCount.current > 0) return;
    const current = vms.find((vm) => vm.id.toLowerCase() === target.id.toLowerCase());
    if (target.mode === "register" && (!current || stateKind(current.state) !== "off" || isProtectedVm(target.id))) return;
    if (target.mode === "unregister" && !templateMap.has(target.id.toLowerCase())) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTemplateAction({ ...target, name: current?.name ?? target.name });
    setTemplateConfirmation("");
    setTemplateActionError(null);
    setActionError(null);
    setNotice(null);
  }

  async function saveTemplateAction() {
    if (!templateAction || !canManage || controlsBusy || operationLock.current || refreshCount.current > 0 || templateConfirmation !== templateAction.name) return;
    const target = templateAction;
    const current = vms.find((vm) => vm.id.toLowerCase() === target.id.toLowerCase());
    if (target.mode === "register" && (!current || stateKind(current.state) !== "off" || isProtectedVm(target.id))) return;
    if (target.mode === "unregister" && !templateMap.has(target.id.toLowerCase())) return;
    operationLock.current = true;
    setTemplateSaving(true);
    setTemplateActionError(null);
    try {
      const updated = await invoke<VmTemplate[]>(target.mode === "register" ? "register_vm_template" : "unregister_vm_template", { id: target.id, confirmationName: templateConfirmation });
      setTemplates(updated);
      setTemplatesKnown(true);
      setTemplatesError(null);
      setVmSection(target.mode === "register" ? "templates" : "vms");
      setSearch("");
      setFilter("all");
      setSelectedId(target.id);
      setTemplateAction(null);
      setNotice(target.mode === "register" ? `「${target.name}」をテンプレートとして登録し、保護しました。` : `「${target.name}」のテンプレート登録を解除しました。VMとディスクは保持されます。`);
      await refresh();
    } catch (error) {
      setTemplateActionError(errorMessage(error));
      await refresh();
    } finally { operationLock.current = false; setTemplateSaving(false); }
  }

  function openSettings() {
    if (!templatesKnown || templateSaving || creating || cloning || busyId || isoLibrary.busy || modalOpen || networkSwitchBusy || operationLock.current) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSettingsOpen(true);
  }

  function openCreate() {
    if (!canManage || pageControlsBusy || operationLock.current || refreshCount.current > 0) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDraft(blankDraft());
    setFormErrors([]);
    setCreateStep("form");
    setActionError(null);
    setCreateOpen(true);
    void isoLibrary.refresh();
  }

  function openShutdown(vm: VmInfo) {
    if (!canManage || isProtectedVm(vm.id) || pageControlsBusy || operationLock.current || refreshCount.current > 0) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setShutdownVm(vm);
  }

  function openClone(vm: VmInfo) {
    if (!canManage || pageControlsBusy || operationLock.current || refreshCount.current > 0 || stateKind(vm.state) !== "off") return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const suggestedName = suggestCloneName(vm, vms);
    setCloneSource(vm);
    setCloneName(suggestedName);
    setCloneConnectNetwork(true);
    setCloneConfigureGuest(true);
    setCloneHostname(suggestGuestHostname(suggestedName));
    setCloneHostnameEdited(false);
    setCloneTemplateReady(false);
    setCloneNameError(null);
    setCloneGuestError(null);
    setCloneProgress(null);
    setActionError(null);
    setNotice(null);
  }

  function closeNetwork() {
    if (networkSaving) return;
    networkRequestSerial.current += 1;
    setNetworkVm(null);
    setNetworkLoading(false);
  }

  async function loadNetworkAdapters(vm: VmInfo) {
    const serial = ++networkRequestSerial.current;
    setNetworkLoading(true);
    setNetworkLoaded(false);
    setNetworkError(null);
    try {
      const adapters = await invoke<VmNetworkAdapter[]>("list_vm_network_adapters", { id: vm.id });
      if (serial !== networkRequestSerial.current) return;
      setNetworkAdapters(networkAdapterDrafts(adapters));
      setNetworkExpectedAdapterIds(adapters.map((adapter) => adapter.id));
      setNetworkLoaded(true);
    } catch (error) {
      if (serial === networkRequestSerial.current) setNetworkError(errorMessage(error));
    } finally {
      if (serial === networkRequestSerial.current) setNetworkLoading(false);
    }
  }

  function openNetwork(vm: VmInfo) {
    if (!canManage || pageControlsBusy || operationLock.current || refreshCount.current > 0) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setNetworkVm(vm);
    setNetworkAdapters([]);
    setNetworkExpectedAdapterIds([]);
    setNetworkError(null);
    setNotice(null);
    void loadNetworkAdapters(vm);
  }

  function openRename(vm: VmInfo) {
    if (!canManage || isProtectedVm(vm.id) || pageControlsBusy || operationLock.current || refreshCount.current > 0) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRenameTarget(vm);
    setRenameName(vm.name);
    setRenameError(null);
    setActionError(null);
    setNotice(null);
  }

  async function renameVm() {
    if (!renameTarget || !canManage || isProtectedVm(renameTarget.id) || controlsBusy || operationLock.current || refreshCount.current > 0 || renameName.trim() === renameTarget.name) return;
    const issue = validateName(renameName, vms.filter((vm) => vm.id !== renameTarget.id));
    setRenameError(issue);
    if (issue) return;
    operationLock.current = true;
    setRenaming(true);
    try {
      const vm = await invoke<VmInfo>("rename_vm", { request: { id: renameTarget.id, name: renameName.trim() } });
      setVms((current) => current.map((item) => item.id === renameTarget.id ? vm : item));
      setSelectedId(vm.id);
      if (!vm.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) setSearch("");
      setRenameTarget(null);
      setNotice(`仮想マシン名を「${vm.name}」に変更しました。`);
      void refresh();
    } catch (error) {
      setRenameError(errorMessage(error));
      void refresh();
    } finally { operationLock.current = false; setRenaming(false); }
  }

  function openDelete(vm: VmInfo) {
    if (!canManage || isProtectedVm(vm.id) || pageControlsBusy || operationLock.current || refreshCount.current > 0 || stateKind(vm.state) !== "off") return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDeleteTarget(vm);
    setDeleteConfirmation("");
    setDeleteError(null);
    setDeleteInfo(null);
    setDeleteDisks(false);
    setActionError(null);
    setNotice(null);
    void loadDeleteInfo(vm);
  }

  function closeDelete() {
    if (deleting) return;
    deleteRequestSerial.current += 1;
    setDeleteTarget(null);
    setDeleteInfoLoading(false);
  }

  async function loadDeleteInfo(vm: VmInfo) {
    const serial = ++deleteRequestSerial.current;
    setDeleteInfoLoading(true);
    setDeleteInfo(null);
    setDeleteDisks(false);
    setDeleteError(null);
    try {
      const info = await invoke<VmDeleteInfo>("get_vm_delete_info", { id: vm.id });
      if (serial !== deleteRequestSerial.current) return;
      if (info.name !== vm.name) setDeleteConfirmation("");
      setDeleteTarget({ ...vm, name: info.name, state: info.state });
      setDeleteInfo(info);
      setVms((current) => current.map((item) => item.id === info.id ? { ...item, name: info.name, state: info.state } : item));
    } catch (error) {
      if (serial === deleteRequestSerial.current) setDeleteError(errorMessage(error));
    } finally {
      if (serial === deleteRequestSerial.current) setDeleteInfoLoading(false);
    }
  }

  async function deleteVm() {
    if (!deleteTarget || !deleteInfo || !canManage || isProtectedVm(deleteTarget.id) || !deleteCanConfirm || controlsBusy || operationLock.current || refreshCount.current > 0) return;
    operationLock.current = true;
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await invoke<VmDeleteResult>("delete_vm", { request: { id: deleteTarget.id, expected_name: deleteTarget.name, confirmation_name: deleteConfirmation, delete_disks: deleteDisks, expected_disk_paths: deleteInfo.disk_paths } });
      const remaining = vms.filter((vm) => vm.id !== deleteTarget.id).sort((a, b) => a.name.localeCompare(b.name, "ja"));
      setVms((current) => current.filter((vm) => vm.id !== deleteTarget.id));
      setSelectedId(remaining[0]?.id ?? null);
      setSearch("");
      setFilter("all");
      setDeleteTarget(null);
      if (result.warning || (deleteDisks && result.retained_disk_paths.length > 0)) {
        setDeleteWarning({ name: deleteTarget.name, result, deleteDisks });
        setNotice(null);
      } else {
        setNotice(deleteDisks ? `「${deleteTarget.name}」の登録と仮想ディスク${result.deleted_disk_paths.length}個を削除しました。` : `「${deleteTarget.name}」の登録を削除しました。仮想ディスクのデータは保持されます。${deleteInfo.has_checkpoints ? "チェックポイントは削除・統合されます。" : ""}`);
      }
      void refresh();
    } catch (error) {
      setDeleteError(errorMessage(error));
      void refresh();
    } finally { operationLock.current = false; setDeleting(false); }
  }

  async function saveNetworkAdapters() {
    if (!networkVm || !canManage || isProtectedVm(networkVm.id) || stateKind(networkVm.state) !== "off" || controlsBusy || !networkLoaded || operationLock.current || refreshCount.current > 0) return;
    if (networkAdapters.length > 8) { setNetworkError("NICは8個以内にしてください。"); return; }
    operationLock.current = true;
    setNetworkSaving(true);
    setNetworkError(null);
    try {
      const request = { vm_id: networkVm.id, expected_adapter_ids: networkExpectedAdapterIds, adapters: networkAdapters.map((adapter) => ({ ...(adapter.id ? { id: adapter.id } : {}), switch_name: adapter.switchName || null })) };
      const adapters = await invoke<VmNetworkAdapter[]>("save_vm_network_adapters", { request });
      setNetworkAdapters(networkAdapterDrafts(adapters));
      setNetworkVm(null);
      setNotice(`「${networkVm.name}」のネットワークを保存しました。`);
      void refresh();
    } catch (error) {
      setNetworkError(errorMessage(error));
      void refresh();
    } finally { operationLock.current = false; setNetworkSaving(false); }
  }

  function closeBoot() {
    if (bootSaving || operationLock.current) return;
    bootRequestSerial.current += 1;
    setBootVm(null);
    setBootLoading(false);
  }

  async function loadBootSettings(vm: VmInfo) {
    if (bootSaving || operationLock.current) return;
    const serial = ++bootRequestSerial.current;
    setBootLoading(true);
    setBootSettings(null);
    setBootError(null);
    try {
      const settings = await invoke<VmBootSettings>("get_vm_boot_settings", { id: vm.id });
      if (serial !== bootRequestSerial.current) return;
      if (settings.vm_id !== vm.id) throw new Error("取得した起動設定の対象VMが一致しません。");
      setBootVm({ ...vm, name: settings.name, state: settings.state, generation: settings.generation });
      setBootSettings(settings);
      setBootEntries([...settings.boot_entries]);
      setBootSecureBoot(settings.secure_boot_enabled);
      setVms((current) => current.map((item) => item.id === settings.vm_id ? { ...item, name: settings.name, state: settings.state, generation: settings.generation } : item));
    } catch (error) {
      if (serial === bootRequestSerial.current) setBootError(errorMessage(error));
    } finally {
      if (serial === bootRequestSerial.current) setBootLoading(false);
    }
  }

  function openBoot(vm: VmInfo) {
    if (!canManage || pageControlsBusy || operationLock.current || refreshCount.current > 0) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBootVm(vm);
    setBootSettings(null);
    setBootEntries([]);
    setBootSecureBoot(null);
    setBootError(null);
    setActionError(null);
    setNotice(null);
    void loadBootSettings(vm);
  }

  async function saveBootSettings() {
    if (!bootVm || !bootSettings || !canManage || !bootCanSave || controlsBusy || operationLock.current || refreshCount.current > 0) return;
    const originalIds = new Set(bootSettings.boot_entries.map((entry) => entry.id));
    if (bootEntries.length !== originalIds.size || new Set(bootEntries.map((entry) => entry.id)).size !== originalIds.size || bootEntries.some((entry) => !originalIds.has(entry.id))) {
      setBootError("起動項目が変わっています。再取得してやり直してください。");
      return;
    }
    operationLock.current = true;
    setBootSaving(true);
    setBootError(null);
    try {
      const request = { vm_id: bootVm.id, expected_revision: bootSettings.revision, secure_boot_enabled: bootSettings.generation === 2 ? bootSecureBoot : null, boot_order: bootEntries.map((entry) => entry.id) };
      const saved = await invoke<VmBootSettings>("save_vm_boot_settings", { request });
      if (saved.vm_id !== bootVm.id) throw new Error("保存した起動設定の対象VMが一致しません。");
      setVms((current) => current.map((item) => item.id === saved.vm_id ? { ...item, name: saved.name, state: saved.state, generation: saved.generation } : item));
      setBootVm(null);
      setNotice(`「${saved.name}」の起動設定を保存しました。`);
      void refresh();
    } catch (error) {
      setBootError(errorMessage(error));
      void refresh();
    } finally { operationLock.current = false; setBootSaving(false); }
  }

  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    if (formErrors.length) setFormErrors([]);
  }

  function advanceCreate() {
    if (controlsBusy || operationLock.current || refreshCount.current > 0) return;
    const issues = validateDraft(draft, vms, isoLibrary.library?.images ?? []);
    setFormErrors(issues);
    if (issues.length === 0) setCreateStep("review");
  }

  async function createVm() {
    if (!createOpen || !canManage || controlsBusy || operationLock.current || refreshCount.current > 0) return;
    const issues = validateDraft(draft, vms, isoLibrary.library?.images ?? []);
    if (issues.length) { setFormErrors(issues); setCreateStep("form"); return; }
    operationLock.current = true;
    setCreating(true);
    setActionError(null);
    try {
      const request = { name: draft.name.trim(), generation: Number(draft.generation), memory_startup_mb: Number(draft.memory), vhd_size_gb: Number(draft.disk), cpu_count: Number(draft.cpu), network_adapters: draft.networkAdapters.map((adapter) => ({ switch_name: adapter.switchName || null })), ...(draft.isoId ? { iso_id: draft.isoId } : {}) };
      const vm = await invoke<VmInfo>("create_vm", { request });
      setVms((current) => [...current.filter((item) => item.id !== vm.id), vm]);
      setSelectedId(vm.id);
      setSearch("");
      setFilter("all");
      setVmSection("vms");
      setCreateOpen(false);
      setNotice(`「${vm.name}」を作成しました。`);
      void refresh();
    } catch (error) {
      setActionError(errorMessage(error));
      setCreateStep("form");
      void refresh();
    } finally { operationLock.current = false; setCreating(false); }
  }

  async function cloneVm() {
    if (!cloneSource || !canManage || controlsBusy || operationLock.current || refreshCount.current > 0) return;
    const nameIssue = validateName(cloneName, vms);
    const guestIssue = cloneConfigureGuest ? validateGuestHostname(cloneHostname) || (!cloneTemplateReady ? "originでテンプレート準備を実行し、停止したことを確認してください。" : null) : null;
    setCloneNameError(nameIssue);
    setCloneGuestError(guestIssue);
    if (nameIssue || guestIssue) return;
    const currentSource = vms.find((vm) => vm.id === cloneSource.id);
    if (!currentSource || stateKind(currentSource.state) !== "off") {
      setActionError("元の仮想マシンを停止してから、もう一度複製してください。");
      void refresh();
      return;
    }
    operationLock.current = true;
    setCloning(true);
    setActionError(null);
    setCloneProgress({ phase: "preparing", message: "複製の準備をしています。" });
    try {
      const onProgress = new Channel<CloneProgress>();
      onProgress.onmessage = (progress) => setCloneProgress(progress);
      const request = { source_id: cloneSource.id, name: cloneName.trim(), connect_network: cloneConnectNetwork, ...(cloneConfigureGuest ? { guest_hostname: cloneHostname } : {}) };
      const vm = await invoke<VmInfo>("clone_vm", { request, onProgress });
      setVms((current) => [...current.filter((item) => item.id !== vm.id), vm]);
      setSelectedId(vm.id);
      setSearch("");
      setFilter("all");
      setVmSection("vms");
      setCloneSource(null);
      setNotice(`「${vm.name}」を複製しました。停止した状態で作成されています。`);
      void refresh();
    } catch (error) {
      setActionError(errorMessage(error));
      void refresh();
    } finally {
      operationLock.current = false;
      setCloning(false);
      setCloneProgress(null);
    }
  }

  async function connectVm(vm: VmInfo) {
    if (!canManage || isProtectedVm(vm.id) || pageControlsBusy || operationLock.current || refreshCount.current > 0 || selectedVm?.id !== vm.id) return;
    const target = vms.find((item) => item.id === vm.id);
    if (!target) return;
    const launchedAt = performance.now();
    operationLock.current = true;
    setConnectingId(target.id);
    setActionError(null);
    setNotice(null);
    try {
      await invoke<void>("connect_vm", { id: target.id });
      setNotice(`「${target.name}」の接続画面を開きました。`);
    } catch (error) {
      setActionError(`「${target.name}」の接続画面を開けませんでした。${errorMessage(error)}`);
    } finally {
      // Keep all VM actions locked while a double click can still land on a
      // different button after the result banner moves the detail panel.
      const remainingLockTime = Math.max(0, 600 - (performance.now() - launchedAt));
      if (remainingLockTime > 0) await new Promise((resolve) => setTimeout(resolve, remainingLockTime));
      operationLock.current = false;
      setConnectingId(null);
    }
  }

  async function runAction(vm: VmInfo, action: "start" | "stop") {
    if (!canManage || isProtectedVm(vm.id) || controlsBusy || networkSwitchBusy || operationLock.current || refreshCount.current > 0 || createOpen || settingsOpen || cloneSource || networkVm || bootVm || renameTarget || deleteTarget || templateAction) return;
    if (shutdownVm && (action !== "stop" || shutdownVm.id !== vm.id)) return;
    operationLock.current = true;
    setBusyId(vm.id);
    setActionError(null);
    setNotice(null);
    try {
      const updated = await invoke<VmInfo>(action === "start" ? "start_vm" : "stop_vm", { id: vm.id });
      setVms((current) => current.map((item) => item.id === vm.id ? updated : item));
      setSelectedId(vm.id);
      setFilter("all");
      setNotice(action === "start" ? `「${vm.name}」を${vm.state.toLowerCase() === "saved" ? "再開" : "起動"}しました。` : `「${vm.name}」へ通常シャットダウンを要求しました。`);
      setShutdownVm(null);
      void refresh();
    } catch (error) {
      setActionError(errorMessage(error));
      setShutdownVm(null);
      void refresh();
    } finally { operationLock.current = false; setBusyId(null); }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="ナビゲーション" inert={modalOpen || networkSwitchBusy}>
        <div className="sidebar-top">
          <div className="brand">
            <span className="brand-mark"><Icon name="server" size={19} /></span>
            <span className="brand-name">Hyper-V Studio</span>
          </div>
          <nav className="sidebar-nav">
            <button className={`sidebar-link ${vmSection === "vms" ? "active" : ""}`} aria-current={vmSection === "vms" ? "page" : undefined} disabled={pageControlsBusy} onClick={() => selectSection("vms")}>
              <Icon name="server" size={17} /><span>仮想マシン</span><small className="sidebar-link-count">{countsUnavailable ? "—" : vms.length - templates.filter((entry) => vms.some((vm) => vm.id.toLowerCase() === entry.vm_id.toLowerCase())).length}</small>
            </button>
            <button className={`sidebar-link ${vmSection === "templates" ? "active" : ""}`} aria-current={vmSection === "templates" ? "page" : undefined} disabled={pageControlsBusy} onClick={() => selectSection("templates")}>
              <Icon name="shield" size={17} /><span>テンプレート</span><small className="sidebar-link-count">{countsUnavailable ? "—" : templates.length}</small>
            </button>
            <button className={`sidebar-link ${vmSection === "network" ? "active" : ""}`} aria-current={vmSection === "network" ? "page" : undefined} disabled={pageControlsBusy} onClick={() => selectSection("network")}>
              <Icon name="network" size={17} /><span>ネットワーク</span>
            </button>
          </nav>
          <div className="sidebar-section-label">ホスト</div>
          <div className="sidebar-host">
            <span className="host-tree-icon"><Icon name="network" size={16} /></span>
            <div className="sidebar-host-copy">
              <strong title={host?.computer_name ?? "この PC"}>{host?.computer_name || "この PC"}</strong>
              <span>ローカル</span>
            </div>
          </div>
        </div>
        <button className="sidebar-settings" type="button" onClick={openSettings} disabled={!templatesKnown || templateSaving || creating || cloning || networkSaving || networkLoading || bootLoading || bootSaving || renaming || deleting || deleteInfoLoading || connectingId !== null || busyId !== null || isoLibrary.busy}>
          <Icon name="settings" size={17} /><span>設定</span>
        </button>
        <div className="sidebar-footer">
          <span className={`connection-dot ${hostCanManage ? "connected" : "disconnected"}`} />
          <div className="connection-copy">
            <span>{loading ? "接続を確認中" : hostCanManage ? "接続済み" : "接続を確認してください"}</span>
            <span className="connection-caption">Windows Hyper-V</span>
          </div>
          <span className="sidebar-footer-version">0.1</span>
        </div>
      </aside>

      <main className="main-content" inert={modalOpen || networkSwitchBusy}>
        {vmSection === "network" ? <NetworkInventory disabled={controlsBusy} canManage={canManage} onBusyChange={setNetworkSwitchBusy} onChanged={refresh} /> : <>
        <header className="topbar">
          <div className="topbar-heading">
            <h1 id="vm-list-title">{vmSection === "templates" ? "テンプレート" : "仮想マシン"}</h1>
            <span className="heading-count">{countsUnavailable ? "—" : sectionCount}</span>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" type="button" onClick={requestRefresh} disabled={pageControlsBusy} aria-label="情報を更新" title="情報を更新">
              <Icon name="refresh" size={16} />
            </button>
            <button className="primary-button" type="button" onClick={openCreate} disabled={!canManage || pageControlsBusy}>
              <Icon name="plus" size={15} />新しいVM
            </button>
          </div>
        </header>
        <div className="workspace-body">
          {(hostError || host?.error || (!hostCanManage && !loading)) && (
            <div className="status-banner warning" role="alert">
              <span className="banner-icon"><Icon name="alert" size={16} /></span>
              <div>
                <strong>Hyper-V に接続できません</strong>
                <p>{hostError || host?.error || "管理権限と Hyper-V の有効化を確認してください。"}</p>
                <small>Hyper-Vが有効で、サービスが実行中であることを確認してください。</small>
              </div>
            </div>
          )}
          {listError && !hostError && !host?.error && (
            <div className="status-banner warning" role="alert">
              <span className="banner-icon"><Icon name="alert" size={16} /></span>
              <div><strong>一覧を取得できませんでした</strong><p>{listError}</p></div>
            </div>
          )}
          {templatesError && <div className="status-banner warning" role="alert"><span className="banner-icon"><Icon name="shield" size={16} /></span><div><strong>テンプレートの保護状態を確認できません</strong><p>{templatesError}</p><small>安全のためVM操作を無効にしています。「情報を更新」から再取得してください。</small></div></div>}
          {actionError && !createOpen && !cloneSource && (
            <div className="status-banner warning" role="alert">
              <span className="banner-icon"><Icon name="alert" size={16} /></span>
              <div><strong>操作を完了できませんでした</strong><p>{actionError}</p></div>
              <button className="banner-close" aria-label="通知を閉じる" onClick={() => setActionError(null)}><Icon name="close" size={14} /></button>
            </div>
          )}
          {notice && (
            <div className="status-banner success" role="status">
              <span className="banner-icon"><Icon name="check" size={16} /></span>
              <div><strong>{notice}</strong></div>
              <button className="banner-close" aria-label="通知を閉じる" onClick={() => setNotice(null)}><Icon name="close" size={14} /></button>
            </div>
          )}
          {deleteWarning && <div className="status-banner warning delete-result-warning" role="alert"><span className="banner-icon"><Icon name="alert" size={16} /></span><div><strong>「{deleteWarning.name}」の登録は削除しました。確認事項があります。</strong><p>{deleteWarning.result.warning || "一部の仮想ディスクが残っています。"}</p>{deleteWarning.deleteDisks && deleteWarning.result.deleted_disk_paths.length > 0 && <small>削除済みディスク: {deleteWarning.result.deleted_disk_paths.length}個</small>}{deleteWarning.deleteDisks && deleteWarning.result.retained_disk_paths.length > 0 && <><small>残っている仮想ディスク:</small><ul className="delete-result-paths">{deleteWarning.result.retained_disk_paths.map((path) => <li key={path}><code>{path}</code></li>)}</ul></>}</div><button className="banner-close" type="button" aria-label="削除結果の通知を閉じる" onClick={() => setDeleteWarning(null)}><Icon name="close" size={14} /></button></div>}
          <div className="workspace-grid">
            <section className="vm-panel" aria-labelledby="vm-list-title" aria-busy={loading}>
              <div className="vm-toolbar">
                <label className="search-field">
                  <Icon name="search" size={15} />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="名前で検索" aria-label="仮想マシン名で検索" />
                </label>
                <div className="filter-tabs" role="group" aria-label="状態で絞り込み">
                  <button className={filter === "all" ? "selected" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>すべて<span className="filter-count">{countsUnavailable ? "—" : sectionCount}</span></button>
                  <button className={filter === "running" ? "selected" : ""} aria-pressed={filter === "running"} onClick={() => setFilter("running")}>実行中<span className="filter-count">{countsUnavailable ? "—" : runningCount}</span></button>
                  <button className={filter === "off" ? "selected" : ""} aria-pressed={filter === "off"} onClick={() => setFilter("off")}>停止中<span className="filter-count">{countsUnavailable ? "—" : offCount}</span></button>
                </div>
              </div>
              <div className="vm-table-head" aria-hidden="true"><span>名前</span><span>状態</span><span>vCPU</span><span>メモリ</span></div>
              <div className="vm-list">
                {loading && (!vms.length || !templatesKnown) ? (
                  <div className="empty-state" role="status"><div className="loading-spinner" /><strong>読み込み中…</strong></div>
                ) : !templatesKnown ? <div className="empty-state"><Icon name="shield" size={22} /><strong>保護状態を確認できていません</strong><p>情報を更新してテンプレート登録を再取得してください。</p></div> : filteredVms.length === 0 && visibleMissingTemplates.length === 0 ? (
                  <div className="empty-state">
                    <Icon name={sectionCount === 0 ? vmSection === "templates" ? "shield" : "server" : "search"} size={22} />
                    <strong>{listError ? "一覧を表示できません" : sectionCount === 0 ? vmSection === "templates" ? "テンプレートはまだありません" : "仮想マシンはまだありません" : "一致する仮想マシンがありません"}</strong>
                    <p>{listError ? "接続を確認し、情報を更新してください。" : sectionCount === 0 ? vmSection === "templates" ? "停止中のVMの詳細からテンプレートとして登録できます。" : "新しいVMから仮想マシンを作成できます。" : "名前や状態の絞り込みを変更してください。"}</p>
                    {sectionCount === 0 && vmSection === "vms" && canManage && !pageControlsBusy && <button className="inline-create" onClick={openCreate}><Icon name="plus" size={14} />仮想マシンを作成</button>}
                  </div>
                ) : filteredVms.map((vm) => (
                  <button key={vm.id} className={`vm-row ${selectedVm?.id === vm.id ? "selected" : ""}`} aria-pressed={selectedVm?.id === vm.id} onClick={() => setSelectedId(vm.id)}>
                    <span className="vm-row-identity">
                      <span className="vm-row-icon"><Icon name={vmSection === "templates" ? "shield" : "server"} size={18} /></span>
                      <span className="vm-row-main"><strong>{vm.name}</strong><small>第 {vm.generation} 世代{vmSection === "templates" ? " · 保護中" : ""}</small></span>
                    </span>
                    <span className="vm-row-state"><span className={`vm-state ${stateKind(vm.state)}`}><span />{stateLabel(vm.state)}</span></span>
                    <span className="vm-row-cpu">{vm.processor_count}</span>
                    <span className="vm-row-memory">{formatMemory(vm.memory_startup_bytes)}</span>
                  </button>
                ))}
                {visibleMissingTemplates.map((entry) => <div key={entry.vm_id} className="missing-template-row"><span className="vm-row-icon"><Icon name="shield" size={18} /></span><div><strong>{entry.registered_name}</strong><p>Hyper-VにVMが見つかりません。登録情報は保持されています。</p><code>{entry.vm_id}</code><button className="text-button" type="button" disabled={!canManage || pageControlsBusy} onClick={() => openTemplateAction({ id: entry.vm_id, name: entry.registered_name, mode: "unregister", missing: true })}>テンプレート登録を解除</button></div></div>)}
              </div>
              <div className="list-footer">
                <span>{countsUnavailable ? "一覧を取得できていません" : `${filteredVms.length + visibleMissingTemplates.length === sectionCount ? sectionCount : `${filteredVms.length + visibleMissingTemplates.length} / ${sectionCount}`} 台`}</span>
                <span>{loading ? "更新中…" : canManage ? host?.computer_name : "未接続"}</span>
              </div>
            </section>

            <aside className="detail-panel" aria-label="仮想マシンの詳細">
              <div className="detail-header"><span>詳細</span><Icon name="server" size={15} /></div>
              {selectedVm ? (
                <div className="detail-content">
                  <div className="detail-identity">
                    <div className="detail-name-row"><h2>{selectedVm.name}</h2>{!selectedIsTemplate && <button className="detail-rename-button" type="button" title="名前を変更" aria-label="名前を変更" disabled={!canManage || pageControlsBusy} onClick={() => openRename(selectedVm)}><Icon name="edit" size={14} /></button>}</div>
                    <p className="detail-subtitle">第 {selectedVm.generation} 世代の{selectedIsTemplate ? "テンプレート" : "仮想マシン"}</p>
                  </div>
                  {selectedIsTemplate && <div className="template-protection"><span className="template-protection-badge"><Icon name="shield" size={13} />保護中</span><p>複製のベースとして登録されています。このアプリでの起動・停止・接続・構成変更・削除を保護します。</p></div>}
                  <span className={`vm-state ${stateKind(selectedVm.state)}`}><span />{stateLabel(selectedVm.state)}</span>
                  {!selectedIsTemplate && <div className="detail-actions">
                    {stateKind(selectedVm.state) === "running" ? (
                      <><button className="shutdown-button" disabled={!canManage || pageControlsBusy} onClick={() => openShutdown(selectedVm)}><Icon name="power" size={15} />{busyId === selectedVm.id ? "処理中…" : "シャットダウン"}</button><p>ゲストOSへ通常のシャットダウンを要求します。</p></>
                    ) : (stateKind(selectedVm.state) === "off" || selectedVm.state.toLowerCase() === "saved") ? (
                      <button className="start-button" disabled={!canManage || pageControlsBusy} onClick={() => void runAction(selectedVm, "start")}><Icon name="play" size={14} />{busyId === selectedVm.id ? "処理中…" : selectedVm.state.toLowerCase() === "saved" ? "再開" : "起動"}</button>
                    ) : (
                      <p className="detail-hint">この状態では起動・停止できません。</p>
                    )}
                  </div>}
                  {!selectedIsTemplate && <div className="detail-connect-action"><button className="secondary-button" type="button" title="VMConnectで接続画面を開く" disabled={!canManage || pageControlsBusy} onClick={() => void connectVm(selectedVm)}><Icon name="monitor" size={15} />{connectingId === selectedVm.id ? "開いています…" : "接続"}</button></div>}
                  <div className="detail-clone-action">
                    <button className={selectedIsTemplate ? "primary-button" : "secondary-button"} type="button" disabled={!canManage || pageControlsBusy || stateKind(selectedVm.state) !== "off"} onClick={() => openClone(selectedVm)}><Icon name="copy" size={15} />{selectedIsTemplate ? "テンプレートから作成" : "複製"}</button>
                    {stateKind(selectedVm.state) !== "off" && <p>複製するには、元のVMを停止してください。</p>}
                  </div>
                  <div className="detail-network-action"><button className="secondary-button" type="button" disabled={!canManage || pageControlsBusy} onClick={() => openNetwork(selectedVm)}><Icon name="network" size={15} />ネットワーク</button></div>
                  <div className="detail-boot-action"><button className="secondary-button" type="button" disabled={!canManage || pageControlsBusy} onClick={() => openBoot(selectedVm)}><Icon name="disk" size={15} />起動設定</button></div>
                  <section className="detail-section">
                    <h3>構成</h3>
                    <div className="detail-specs">
                      <div><span>プロセッサ</span><strong>{selectedVm.processor_count} vCPU</strong></div>
                      <div><span>起動メモリ</span><strong>{formatMemory(selectedVm.memory_startup_bytes)}</strong></div>
                      <div><span>割当メモリ</span><strong>{formatMemory(selectedVm.memory_assigned_bytes)}</strong></div>
                      <div><span>稼働時間</span><strong>{stateKind(selectedVm.state) === "running" ? formatUptime(selectedVm.uptime_seconds) : "—"}</strong></div>
                    </div>
                  </section>
                  <section className="detail-section">
                    <h3>仮想マシンID</h3>
                    <div className="detail-id"><code>{selectedVm.id}</code></div>
                  </section>
                  <section className="detail-section detail-template-section">
                    <button className="text-button" type="button" disabled={!canManage || pageControlsBusy || (!selectedIsTemplate && stateKind(selectedVm.state) !== "off")} onClick={() => openTemplateAction({ id: selectedVm.id, name: selectedVm.name, mode: selectedIsTemplate ? "unregister" : "register" })}>{selectedIsTemplate ? "テンプレート登録を解除…" : "テンプレートとして登録…"}</button>
                    <p>{selectedIsTemplate ? "編集するには、確認画面から登録と保護を解除してください。" : stateKind(selectedVm.state) === "off" ? "複製のベースとして分け、変更から保護します。" : "登録するにはVMを停止してください。"}</p>
                  </section>
                  {!selectedIsTemplate && <section className="detail-section detail-delete-section"><button className="text-button detail-delete-button" type="button" disabled={!canManage || pageControlsBusy || stateKind(selectedVm.state) !== "off"} onClick={() => openDelete(selectedVm)}>VMを削除</button>{stateKind(selectedVm.state) !== "off" && <p>削除するにはVMを停止してください。</p>}</section>}
                </div>
              ) : (
                <div className="detail-empty"><Icon name="server" size={22} /><strong>仮想マシンの詳細</strong><p>一覧から仮想マシンを選択してください。</p></div>
              )}
            </aside>
          </div>
        </div>
        </>}
      </main>

      {settingsOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !isoLibrary.busy) setSettingsOpen(false); }}>
          <div ref={dialogRef} className={`modal settings-modal ${settingsSection === "images" ? "iso-settings-modal" : ""}`} role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="modal-header">
              <h2 id="settings-title">設定</h2>
              <button className="icon-button" type="button" aria-label="設定を閉じる" disabled={isoLibrary.busy} onClick={() => setSettingsOpen(false)}><Icon name="close" size={17} /></button>
            </div>
            <div className="settings-layout">
              <nav className="settings-nav" aria-label="設定の項目">
                <button type="button" className={`settings-nav-item ${settingsSection === "appearance" ? "active" : ""}`} aria-current={settingsSection === "appearance" ? "page" : undefined} disabled={isoLibrary.busy} onClick={() => setSettingsSection("appearance")}><Icon name="sun" size={16} />外観</button>
                <button type="button" className={`settings-nav-item ${settingsSection === "images" ? "active" : ""}`} aria-current={settingsSection === "images" ? "page" : undefined} disabled={isoLibrary.busy} onClick={() => setSettingsSection("images")}><Icon name="disk" size={16} />OSイメージ</button>
              </nav>
              <div className="settings-content">
                {settingsSection === "images" ? <IsoLibrarySettings controller={isoLibrary} /> : <>
                <h3>外観</h3>
                <p className="settings-description">アプリの表示テーマを選択します。</p>
                <fieldset className="theme-fieldset">
                  <legend>テーマ</legend>
                  <div className="theme-options">
                    {themeOptions.map((option) => (
                      <label key={option.value} className="theme-option">
                        <input className="theme-radio" type="radio" name="theme" value={option.value} checked={appearance.preference === option.value} onChange={() => appearance.changePreference(option.value)} autoFocus={appearance.preference === option.value} />
                        <span className={`theme-preview theme-preview-${option.value}`} aria-hidden="true"><span className="theme-preview-rail" /><span className="theme-preview-main"><span className="theme-preview-line" /><span className="theme-preview-line" /><span className="theme-preview-line" /></span></span>
                        <span className="theme-option-label"><Icon name={option.icon} size={14} /><span>{option.label}</span></span>
                        <span className="theme-option-check" aria-hidden="true"><Icon name="check" size={12} /></span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <p className="settings-help">変更はすぐに反映され、次回の起動時にも引き継がれます。</p>
                {appearance.saveError && <p className="settings-error" role="alert">{appearance.saveError}</p>}
                {appearance.nativeError && <p className="settings-error" role="alert">{appearance.nativeError}</p>}
                </>}
              </div>
            </div>
            <div className="modal-footer"><button className="primary-button" type="button" disabled={isoLibrary.busy} onClick={() => setSettingsOpen(false)}>完了</button></div>
          </div>
        </div>
      )}

      {createOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !creating) setCreateOpen(false); }}>
          <div ref={dialogRef} className="modal create-modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
            <div className="modal-header">
              <div><h2 id="create-title">新しい仮想マシン</h2><p>このPCのHyper-Vに作成します。</p></div>
              <button className="icon-button" aria-label="閉じる" disabled={creating} onClick={() => setCreateOpen(false)}><Icon name="close" size={17} /></button>
            </div>
            <div className="step-indicator" aria-label="作成の手順"><span className={createStep === "form" ? "current" : ""}>1. 構成</span><span className="step-line" /><span className={createStep === "review" ? "current" : ""}>2. 確認</span></div>
            {createStep === "form" ? (
              <div className="modal-body">
                {actionError && <div className="form-errors" role="alert"><Icon name="alert" size={15} /><span>{actionError}</span></div>}
                <div className="form-field"><label htmlFor="vm-name">名前 <span className="required">必須</span></label><input id="vm-name" autoFocus value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} placeholder="Development-VM" maxLength={64} /></div>
                <div className="form-grid">
                  <div className="form-field"><label htmlFor="vm-generation">世代</label><select id="vm-generation" value={draft.generation} onChange={(event) => updateDraft("generation", event.target.value as Draft["generation"])}><option value="2">第2世代（推奨）</option><option value="1">第1世代</option></select></div>
                  <div className="form-field"><label htmlFor="vm-cpu">プロセッサ</label><div className="input-unit"><input id="vm-cpu" type="number" min="1" max="64" step="1" value={draft.cpu} onChange={(event) => updateDraft("cpu", event.target.value)} /><span>vCPU</span></div></div>
                </div>
                <div className="form-grid">
                  <div className="form-field"><label htmlFor="vm-memory">起動メモリ</label><div className="input-unit"><input id="vm-memory" type="number" min="512" max="131072" step="1" value={draft.memory} onChange={(event) => updateDraft("memory", event.target.value)} /><span>MB</span></div></div>
                  <div className="form-field"><label htmlFor="vm-disk">仮想ディスク</label><div className="input-unit"><input id="vm-disk" type="number" min="8" max="2048" step="1" value={draft.disk} onChange={(event) => updateDraft("disk", event.target.value)} /><span>GiB</span></div></div>
                </div>
                <section className="create-network-section" aria-labelledby="create-network-title"><div className="network-section-heading"><h3 id="create-network-title">ネットワーク</h3><span>任意 · 最大8 NIC</span></div><NetworkAdaptersEditor adapters={draft.networkAdapters} switches={host?.switches ?? []} onChange={(adapters) => updateDraft("networkAdapters", adapters)} disabled={creating} /></section>
                <div className="form-field os-image-selector">
                  <label htmlFor="vm-os">OS <span className="optional">任意</span></label>
                  <select id="vm-os" value={draft.isoId} disabled={isoLibrary.loading} onChange={(event) => updateDraft("isoId", event.target.value)}>
                    <option value="">{isoLibrary.loading ? "OSイメージを読み込み中…" : "OSを指定しない（空のVM）"}</option>
                    {isoLibrary.library?.images.map((image) => <option key={image.id} value={image.id} disabled={!image.available}>{image.name}{image.available ? "" : "（ISOなし）"}</option>)}
                  </select>
                  {selectedIso ? <div className="os-image-summary"><p>{osFamilyLabel[selectedIso.os_family]} · {formatIsoSize(selectedIso.size_bytes)}</p><small>{selectedIso.file_name}</small>{draft.generation === "2" && selectedIso.os_family === "linux" && <small>Secure Bootは有効です（Linux用証明書）。</small>}</div> : <small>「設定 → OSイメージ」からISOを取り込めます。</small>}
                  {isoLibrary.error && <small className="os-image-warning">OSイメージを取得できませんでした。設定から再取得してください。</small>}
                </div>
                {formErrors.length > 0 && <div className="form-errors" role="alert"><Icon name="alert" size={15} /><ul>{formErrors.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}
              </div>
            ) : (
              <div className="modal-body review-body">
                <div className="review-lead"><strong>構成を確認</strong><p>新しい仮想マシンとVHDXを作成します。</p></div>
                <div className="review-table">
                  <div><span>名前</span><strong>{draft.name.trim()}</strong></div>
                  <div><span>世代</span><strong>第{draft.generation}世代</strong></div>
                  <div><span>構成バージョン</span><strong>{newVmVersion}</strong></div>
                  <div><span>プロセッサ</span><strong>{draft.cpu} vCPU</strong></div>
                  <div><span>起動メモリ</span><strong>{Number(draft.memory).toLocaleString("ja-JP")} MB{Number(draft.memory) % 1024 === 0 ? `（${Number(draft.memory) / 1024} GiB）` : ""}</strong></div>
                  <div><span>仮想ディスク</span><strong>{Number(draft.disk).toLocaleString("ja-JP")} GiB</strong></div>
                  <div><span>起動順序</span><strong>{selectedIso ? "DVD（ISO）→仮想HDD" : "仮想HDDを優先"}</strong></div>
                  {draft.generation === "2" && <div><span>Secure Boot</span><strong>有効（{selectedIso?.os_family === "linux" ? "Linux用証明書" : selectedIso?.os_family === "windows" ? "Windows用証明書" : "既定の証明書"}）</strong></div>}
                  {draft.networkAdapters.length === 0 ? <div><span>ネットワーク</span><strong>NICなし</strong></div> : draft.networkAdapters.map((adapter, index) => <div key={adapter.key}><span>NIC {index + 1}</span><strong>{adapter.switchName || "接続しない"}</strong></div>)}
                  <div><span>OS</span><strong>{selectedIso?.name || "指定なし（空のVM）"}</strong></div>
                  {selectedIso && <div><span>ISOファイル</span><strong className="review-path">{selectedIso.file_name}</strong></div>}
                  <div><span>VM保存先</span><strong className="review-path">{newVmDirectory}</strong></div>
                  <div><span>仮想ディスク保存先</span><strong className="review-path">{newVmVhdPath}</strong></div>
                </div>
                <p className="review-note"><Icon name="info" size={15} />{selectedIso ? "ISOを接続し、DVDを優先する起動順序で作成します。OSのインストールはVM起動後に行ってください。" : "仮想HDDから起動します。OSのインストールは、VM作成後に行ってください。"}</p>
              </div>
            )}
            <div className="modal-footer">
              <button className="secondary-button" disabled={creating} onClick={() => createStep === "review" ? setCreateStep("form") : setCreateOpen(false)}>{createStep === "review" ? "戻る" : "キャンセル"}</button>
              <button className="primary-button" disabled={controlsBusy} onClick={() => createStep === "form" ? advanceCreate() : void createVm()}>{creating ? "作成中…" : createStep === "form" ? "確認へ" : "作成"}</button>
            </div>
          </div>
        </div>
      )}

      {templateAction && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !templateSaving) setTemplateAction(null); }}>
          <div ref={dialogRef} className="modal template-modal" role="dialog" aria-modal="true" aria-labelledby="template-action-title" aria-describedby="template-action-description" aria-busy={templateSaving}>
            <div className="modal-header"><div><h2 id="template-action-title">{templateAction.mode === "register" ? "テンプレートとして登録" : "テンプレート登録を解除"}</h2><p>{templateAction.name}</p></div><button className="icon-button" type="button" disabled={templateSaving} aria-label="テンプレートの確認を閉じる" onClick={() => setTemplateAction(null)}><Icon name="close" size={17} /></button></div>
            <form onSubmit={(event) => { event.preventDefault(); void saveTemplateAction(); }}>
              <div className="modal-body">
                {templateAction.mode === "register" ? <><p id="template-action-description" className="template-action-description">このVMを複製のベースとして登録し、テンプレートの一覧へ移動します。</p><div className="template-protection-scope"><strong><Icon name="shield" size={15} />登録中はこのアプリで次の操作を保護します</strong><ul><li>起動・停止・接続</li><li>VM名・ネットワーク・起動設定の変更</li><li>VMと仮想ディスクの削除</li></ul><p>構成の閲覧と複製はできます。変更する場合は、先に登録を解除してください。</p></div><p className="template-scope-note">Hyper-Vマネージャーや他のツールからの操作は制限しません。登録だけではOS内部のテンプレート準備は実行しません。</p></> : <><p id="template-action-description" className="template-action-description">テンプレート登録と、このアプリでの保護を解除します。VMと仮想ディスクは削除しません。</p><p className="template-scope-note">{templateAction.missing ? "Hyper-VにVMが見つからないため、残っているテンプレート登録情報を解除します。" : "通常の仮想マシンの一覧に戻り、起動や構成変更ができるようになります。"}</p></>}
                <div className="form-field"><label htmlFor="template-confirmation">確認のためVM名を入力 <span className="required">必須</span></label><input id="template-confirmation" autoFocus autoComplete="off" spellCheck={false} disabled={templateSaving} value={templateConfirmation} onChange={(event) => setTemplateConfirmation(event.target.value)} aria-describedby="template-confirmation-help" /><small id="template-confirmation-help">「{templateAction.name}」と大文字・小文字を含めて完全一致するように入力してください。</small></div>
                {templateActionError && <div className="form-errors" role="alert"><Icon name="alert" size={15} /><span>{templateActionError}</span></div>}
                {templateSaving && <p className="template-action-progress" role="status">{templateAction.mode === "register" ? "テンプレートを登録しています…" : "テンプレート登録を解除しています…"}</p>}
              </div>
              <div className="modal-footer"><button className="secondary-button" type="button" disabled={templateSaving} onClick={() => setTemplateAction(null)}>キャンセル</button><button className="primary-button" type="submit" disabled={!canManage || controlsBusy || !templateCanConfirm}>{templateSaving ? "処理中…" : templateAction.mode === "register" ? "登録して保護" : "登録と保護を解除"}</button></div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleting) closeDelete(); }}>
          <div ref={dialogRef} className="modal delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-scope" aria-busy={deleting || deleteInfoLoading}>
            <div className="modal-header"><h2 id="delete-title">VMを削除</h2><button className="icon-button" type="button" autoFocus aria-label="削除確認を閉じる" disabled={deleting} onClick={closeDelete}><Icon name="close" size={17} /></button></div>
            <form className="delete-form" onSubmit={(event) => { event.preventDefault(); void deleteVm(); }}>
              <div className="modal-body">
                <p className="delete-target-name">{deleteTarget.name}</p>
                <p id="delete-scope" className="delete-scope">{deleteDisks ? "Hyper-Vの登録と表示した仮想ディスクを削除します。元に戻せません。" : deleteInfo?.has_checkpoints ? "Hyper-Vの登録を削除します。チェックポイントは削除・統合され、仮想ディスクのデータは保持されます。" : "Hyper-Vの登録を削除します。仮想ディスクのデータは保持されます。"}</p>
                {deleteInfoLoading ? <div className="network-loading" role="status"><div className="loading-spinner" /><span>削除対象を確認しています…</span></div> : deleteInfo && <>
                  <div className="delete-disk-list"><span>接続中のディスク <small>{deleteInfo.disk_paths.length}個</small></span>{deleteInfo.disk_paths.length > 0 ? <ul>{deleteInfo.disk_paths.map((path) => <li key={path}><code>{path}</code></li>)}</ul> : <p>仮想ディスクはありません。</p>}</div>
                  <label className="delete-disks-option" htmlFor="delete-disks"><input id="delete-disks" type="checkbox" checked={deleteDisks} disabled={deleting || !deleteInfo.can_delete_disks} onChange={(event) => setDeleteDisks(event.target.checked)} /><span>仮想ディスクも削除</span></label>
                  <p className="delete-disk-guidance">バックアップや未登録のVMで再利用するディスクは残してください。</p>
                  {!deleteInfo.can_delete_disks && deleteInfo.disk_delete_reason && <p className="delete-disk-reason">{deleteInfo.disk_delete_reason}</p>}
                  {stateKind(deleteInfo.state) !== "off" && <p className="delete-disk-reason">削除するにはVMを停止してください。</p>}
                </>}
                <div className="form-field"><label htmlFor="delete-confirmation">確認のためVM名を入力 <span className="required">必須</span></label><input id="delete-confirmation" ref={deleteConfirmationRef} autoComplete="off" spellCheck={false} disabled={deleting || deleteInfoLoading || !deleteInfo} value={deleteConfirmation} onChange={(event) => { setDeleteConfirmation(event.target.value); }} aria-describedby="delete-confirmation-help" /><small id="delete-confirmation-help">大文字・小文字を含め、上のVM名と完全一致するように入力してください。</small></div>
                {deleteError && <div className="form-errors" role="alert"><Icon name="alert" size={15} /><span>{deleteError}</span></div>}
                {deleteError && <button className="text-button delete-reload" type="button" disabled={deleting || deleteInfoLoading} onClick={() => void loadDeleteInfo(deleteTarget)}>削除対象を再取得</button>}
                {deleting && <p className="delete-progress" role="status">VMの登録を削除しています…</p>}
              </div>
              <div className="modal-footer"><button className="secondary-button" type="button" disabled={deleting} onClick={closeDelete}>キャンセル</button><button className="primary-button danger-confirm-button" type="submit" disabled={!canManage || controlsBusy || !deleteCanConfirm}>{deleting ? "削除中…" : "VMを削除"}</button></div>
            </form>
          </div>
        </div>
      )}

      {renameTarget && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !renaming) setRenameTarget(null); }}>
          <div ref={dialogRef} className="modal rename-modal" role="dialog" aria-modal="true" aria-labelledby="rename-title" aria-busy={renaming}>
            <div className="modal-header"><div><h2 id="rename-title">名前を変更</h2><p>{renameTarget.name}</p></div><button className="icon-button" type="button" aria-label="名前変更を閉じる" disabled={renaming} onClick={() => setRenameTarget(null)}><Icon name="close" size={17} /></button></div>
            <form className="rename-form" onSubmit={(event) => { event.preventDefault(); void renameVm(); }}>
              <div className="modal-body">
                <div className="form-field"><label htmlFor="rename-name">仮想マシン名 <span className="required">必須</span></label><input id="rename-name" autoFocus disabled={renaming} value={renameName} maxLength={64} onChange={(event) => { setRenameName(event.target.value); setRenameError(null); }} aria-describedby={renameError ? "rename-error rename-help" : "rename-help"} /></div>
                <p id="rename-help" className="rename-help">Hyper-V上の名前を変更します。OS内部のホスト名は変わりません。</p>
                {renameError && <div id="rename-error" className="form-errors" role="alert"><Icon name="alert" size={15} /><span>{renameError}</span></div>}
                {renaming && <p className="rename-saving" role="status">名前を変更しています…</p>}
              </div>
              <div className="modal-footer"><button className="secondary-button" type="button" disabled={renaming} onClick={() => setRenameTarget(null)}>キャンセル</button><button className="primary-button" type="submit" disabled={!canManage || isProtectedVm(renameTarget.id) || controlsBusy || renameName.trim() === renameTarget.name}>{renaming ? "保存中…" : "保存"}</button></div>
            </form>
          </div>
        </div>
      )}

      {bootVm && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !bootSaving) closeBoot(); }}>
          <div ref={dialogRef} className="modal boot-modal" role="dialog" aria-modal="true" aria-labelledby="boot-title" aria-describedby="boot-description" aria-busy={bootLoading || bootSaving}>
            <div className="modal-header"><div><h2 id="boot-title">起動設定</h2><p id="boot-description">{bootVm.name} · 第{bootVm.generation}世代</p></div><button className="icon-button" type="button" autoFocus disabled={bootSaving} aria-label="起動設定を閉じる" onClick={closeBoot}><Icon name="close" size={17} /></button></div>
            <div className="modal-body">
              {bootError && <div className="form-errors" role="alert"><Icon name="alert" size={15} /><span>{bootError}</span></div>}
              {bootLoading ? <div className="network-loading" role="status"><div className="loading-spinner" /><span>起動設定を読み込んでいます…</span></div> : bootSettings && <>
                <p className="boot-edit-hint">{!templatesKnown ? "保護状態を確認できないため閲覧のみです。一度閉じて、情報を更新してください。" : isProtectedVm(bootVm.id) ? "テンプレートは保護中のため閲覧のみです。変更するには登録を解除してください。" : bootCanEdit ? "変更は「保存」で反映します。" : "現在は閲覧のみです。変更するにはVMを停止してください。"}</p>
                <BootSettingsEditor settings={bootSettings} entries={bootEntries} secureBootEnabled={bootSecureBoot} onEntriesChange={setBootEntries} onSecureBootChange={setBootSecureBoot} disabled={bootSaving || !canManage} readOnly={!bootCanEdit} />
              </>}
              {bootSaving && <p className="boot-saving" role="status">起動設定を保存しています…</p>}
            </div>
            <div className="modal-footer boot-modal-footer"><button className="text-button" type="button" disabled={bootLoading || bootSaving} title="未保存の変更を破棄して再取得" onClick={() => void loadBootSettings(bootVm)}><Icon name="refresh" size={14} />再取得</button><div className="boot-footer-actions">{bootCanEdit ? <><button className="secondary-button" type="button" disabled={bootSaving} onClick={closeBoot}>キャンセル</button><button className="primary-button" type="button" disabled={!canManage || controlsBusy || !bootCanSave} onClick={() => void saveBootSettings()}>{bootSaving ? "保存中…" : "保存"}</button></> : <button className="primary-button" type="button" disabled={bootSaving} onClick={closeBoot}>閉じる</button>}</div></div>
          </div>
        </div>
      )}

      {networkVm && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !networkSaving) closeNetwork(); }}>
          <div ref={dialogRef} className="modal network-modal" role="dialog" aria-modal="true" aria-labelledby="network-title" aria-describedby="network-description" aria-busy={networkLoading || networkSaving}>
            <div className="modal-header"><div><h2 id="network-title">ネットワーク</h2><p id="network-description">{networkVm.name}</p></div><button className="icon-button" type="button" autoFocus disabled={networkSaving} aria-label="ネットワークを閉じる" onClick={closeNetwork}><Icon name="close" size={17} /></button></div>
            <div className="modal-body">
              {networkError && <><div className="form-errors" role="alert"><Icon name="alert" size={15} /><span>{networkError}</span></div>{networkLoaded && <button className="text-button network-reload" type="button" disabled={networkLoading || networkSaving} onClick={() => void loadNetworkAdapters(networkVm)}>構成を再取得（編集を破棄）</button>}</>}
              {networkLoading ? <div className="network-loading" role="status"><div className="loading-spinner" /><span>NICの構成を読み込んでいます…</span></div> : networkLoaded ? <>
                <p className="network-edit-hint">{!templatesKnown ? "保護状態を確認できないため閲覧のみです。一度閉じて、情報を更新してください。" : isProtectedVm(networkVm.id) ? "テンプレートは保護中のため閲覧のみです。変更するには登録を解除してください。" : networkCanEdit ? "NICの追加・削除・接続先の変更は「保存」で反映します。" : "現在は閲覧のみです。変更するにはVMを停止してください。"}</p>
                <NetworkAdaptersEditor adapters={networkAdapters} switches={host?.switches ?? []} onChange={setNetworkAdapters} disabled={networkSaving || !canManage} readOnly={!networkCanEdit} />
                <p className="network-guest-hint">追加したNICはゲストOS内でも設定が必要です。複製時のDHCP自動設定は、複製した時点のNICが対象です。</p>
              </> : <button className="secondary-button" type="button" disabled={networkSaving} onClick={() => void loadNetworkAdapters(networkVm)}>再取得</button>}
              {networkSaving && <p className="network-saving" role="status">ネットワークを保存しています…</p>}
            </div>
            <div className="modal-footer">{networkCanEdit ? <><button className="secondary-button" type="button" disabled={networkSaving} onClick={closeNetwork}>キャンセル</button><button className="primary-button" type="button" disabled={!canManage || !networkLoaded || controlsBusy} onClick={() => void saveNetworkAdapters()}>{networkSaving ? "保存中…" : "保存"}</button></> : <button className="primary-button" type="button" onClick={closeNetwork}>閉じる</button>}</div>
          </div>
        </div>
      )}

      {cloneSource && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !cloning) setCloneSource(null); }}>
          <div ref={dialogRef} className="modal clone-modal" role="dialog" aria-modal="true" aria-labelledby="clone-title" aria-describedby="clone-description" aria-busy={cloning}>
            <div className="modal-header">
              <div><h2 id="clone-title">{templateMap.has(cloneSource.id.toLowerCase()) ? "テンプレートから作成" : "仮想マシンを複製"}</h2><p id="clone-description">停止中・チェックポイントなしのVMに対応します。</p></div>
              <button className="icon-button" type="button" aria-label="複製を閉じる" disabled={cloning} onClick={() => setCloneSource(null)}><Icon name="close" size={17} /></button>
            </div>
            {cloning && <div className="clone-progress" role="status" aria-live="polite" aria-atomic="true"><div className="loading-spinner" aria-hidden="true" /><div><strong>複製しています</strong><p>{cloneProgress?.message || "複製の準備をしています。"}</p><small>完了するまでアプリを開いたままお待ちください。</small></div></div>}
            <div className="modal-body">
              {actionError && <div className="form-errors" role="alert"><Icon name="alert" size={15} /><span>{actionError}</span></div>}
              <div className="clone-source"><span>元の仮想マシン</span><strong>{cloneSource.name}</strong></div>
              <div className="form-field">
                <label htmlFor="clone-name">複製先の名前 <span className="required">必須</span></label>
                <input id="clone-name" autoFocus disabled={cloning} value={cloneName} onChange={(event) => { const value = event.target.value; setCloneName(value); setCloneNameError(null); if (!cloneHostnameEdited) { setCloneHostname(suggestGuestHostname(value)); setCloneGuestError(null); } }} maxLength={64} aria-invalid={cloneNameError ? true : undefined} aria-describedby={cloneNameError ? "clone-name-error" : undefined} />
              </div>
              {cloneNameError && <div id="clone-name-error" className="form-errors" role="alert"><Icon name="alert" size={15} /><span>{cloneNameError}</span></div>}
              <label className="clone-network-option clone-auto-option" htmlFor="clone-auto-configure">
                <input id="clone-auto-configure" type="checkbox" disabled={cloning} checked={cloneConfigureGuest} onChange={(event) => { setCloneConfigureGuest(event.target.checked); setCloneGuestError(null); }} />
                <span>OS内部も自動設定<small>AlmaLinux・Rocky Linux・RHEL 9 / 10に対応します。</small></span>
              </label>
              {cloneConfigureGuest && <div className="clone-guest-settings">
                <div className="form-field">
                  <label htmlFor="clone-hostname">OSのホスト名 <span className="required">必須</span></label>
                  <input id="clone-hostname" disabled={cloning} value={cloneHostname} onChange={(event) => { setCloneHostname(event.target.value); setCloneHostnameEdited(true); setCloneGuestError(null); }} maxLength={63} autoComplete="off" spellCheck={false} aria-invalid={cloneGuestError && validateGuestHostname(cloneHostname) ? true : undefined} aria-describedby="clone-hostname-help" />
                  <small id="clone-hostname-help">1〜63文字の小文字英数字とハイフン。先頭・末尾は英数字。</small>
                </div>
                <div className="clone-ip-setting"><span>IPアドレス</span><strong>全NICでDHCPを自動取得</strong></div>
                <details className="clone-template-steps" inert={cloning}>
                  <summary>テンプレートの準備手順</summary>
                  <div>
                    <p>初回のみoriginのLinux内でこのスクリプトを保存し、次を実行します。cloud-initを準備し、最後にVMを停止します。</p>
                    <code className="clone-prepare-command">sudo bash prepare-linux-template.sh --shutdown</code>
                    <p>準備後はoriginを起動せずに複製してください。originを更新・再起動したら、もう一度準備を実行します。</p>
                    <label htmlFor="clone-template-script">準備用スクリプト</label>
                    <textarea id="clone-template-script" readOnly disabled={cloning} value={prepareLinuxTemplate} spellCheck={false} />
                    <a className="secondary-button" href={cloning ? undefined : templateDownloadUrl} download="prepare-linux-template.sh" aria-disabled={cloning}>スクリプトを保存</a>
                  </div>
                </details>
                <label className="clone-network-option clone-ready-option" htmlFor="clone-template-ready">
                  <input id="clone-template-ready" type="checkbox" disabled={cloning} checked={cloneTemplateReady} onChange={(event) => { setCloneTemplateReady(event.target.checked); setCloneGuestError(null); }} />
                  <span>originでテンプレート準備を実行して停止済み <span className="required">必須</span></span>
                </label>
              </div>}
              {cloneGuestError && <div className="form-errors" role="alert"><Icon name="alert" size={15} /><span>{cloneGuestError}</span></div>}
              <label className="clone-network-option" htmlFor="clone-network">
                <input id="clone-network" type="checkbox" disabled={cloning} checked={cloneConnectNetwork} onChange={(event) => setCloneConnectNetwork(event.target.checked)} />
                <span>元と同じネットワークに接続<small>各NICで元と同じ仮想スイッチを使用します。</small></span>
              </label>
              <div className="clone-notes">
                <p>ディスクを含む完全コピーを作成します。元のVMとは独立し、コピー分の空き容量と時間が必要です。</p>
                <p>VMとディスクは {newVmBasePath} 配下に保存します。</p>
                <p>NICの構成は引き継がれます。接続先やNICの追加・削除は、複製後の「ネットワーク」から変更できます。</p>
                {cloneConfigureGuest ? <><p>次回起動でホスト名・新しいmachine-id・SSHホスト鍵・DHCPを設定します。基本ユーザーと認証設定は維持します。</p><p>停止状態で作成し、元のインストールISOを外して初回設定用ディスクを接続します。</p></> : <><p>ゲストOSのホスト名・IPアドレス・識別情報は引き継がれます。必要に応じて変更してからネットワークに接続してください。</p><p>複製後は停止状態になります。インストール用ISOは接続しません。</p></>}
              </div>
            </div>
            <div className="modal-footer">
              <button className="secondary-button" type="button" disabled={cloning} onClick={() => setCloneSource(null)}>キャンセル</button>
              <button className="primary-button" type="button" disabled={controlsBusy} onClick={() => void cloneVm()}><Icon name="copy" size={14} />{cloning ? "複製中…" : "複製"}</button>
            </div>
          </div>
        </div>
      )}

      {shutdownVm && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyId) setShutdownVm(null); }}>
          <div ref={dialogRef} className="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="shutdown-title">
            <h2 id="shutdown-title">シャットダウンしますか？</h2>
            <p>「{shutdownVm.name}」のゲストOSへ通常のシャットダウンを要求します。</p>
            <div className="modal-footer">
              <button className="secondary-button" autoFocus disabled={!!busyId} onClick={() => setShutdownVm(null)}>キャンセル</button>
              <button className="shutdown-button" disabled={controlsBusy} onClick={() => void runAction(shutdownVm, "stop")}><Icon name="power" size={15} />{busyId ? "処理中…" : "シャットダウン"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
