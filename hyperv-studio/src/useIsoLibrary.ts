import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";

export type OsFamily = "windows" | "linux" | "other";
export type IsoImage = {
  id: string;
  name: string;
  os_family: OsFamily;
  file_name: string;
  size_bytes: number;
  imported_at: number;
  available: boolean;
};
export type IsoLibrary = { directory: string; images: IsoImage[] };
export type ImportIsoRequest = { source_path: string; name: string; os_family: OsFamily };
export type IsoImportProgress = { copied_bytes: number; total_bytes: number };

function message(error: unknown) {
  return typeof error === "string" ? error : error instanceof Error ? error.message : "ISOの操作に失敗しました。";
}

export function formatIsoSize(bytes: number) {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function useIsoLibrary() {
  const [library, setLibrary] = useState<IsoLibrary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<IsoImportProgress | null>(null);
  const mutationLock = useRef(false);
  const loadSerial = useRef(0);

  const refresh = useCallback(async () => {
    const serial = ++loadSerial.current;
    setLoading(true);
    try {
      const result = await invoke<IsoLibrary>("list_iso_images");
      if (serial === loadSerial.current) { setLibrary(result); setError(null); }
    } catch (cause) {
      if (serial === loadSerial.current) setError(message(cause));
    } finally {
      if (serial === loadSerial.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => { loadSerial.current += 1; };
  }, [refresh]);

  async function pickFile(): Promise<string | null> {
    if (mutationLock.current) return null;
    mutationLock.current = true;
    setBusy(true);
    setError(null);
    try { return await invoke<string | null>("pick_iso_file"); }
    catch (cause) { setError(message(cause)); return null; }
    finally { mutationLock.current = false; setBusy(false); }
  }

  async function importImage(request: ImportIsoRequest): Promise<IsoImage | null> {
    if (mutationLock.current) return null;
    mutationLock.current = true;
    setBusy(true);
    setError(null);
    setProgress({copied_bytes: 0, total_bytes: 0});
    try {
      const onProgress = new Channel<IsoImportProgress>();
      onProgress.onmessage = setProgress;
      const image = await invoke<IsoImage>("import_iso_image", {request, onProgress});
      await refresh();
      return image;
    } catch (cause) { setError(message(cause)); return null; }
    finally { mutationLock.current = false; setBusy(false); setProgress(null); }
  }

  async function removeImage(id: string): Promise<boolean> {
    if (mutationLock.current) return false;
    mutationLock.current = true;
    setBusy(true);
    setError(null);
    try { await invoke("remove_iso_image", {id}); await refresh(); return true; }
    catch (cause) { setError(message(cause)); return false; }
    finally { mutationLock.current = false; setBusy(false); }
  }

  return {library, loading, error, busy, progress, refresh, pickFile, importImage, removeImage};
}

export type IsoLibraryController = ReturnType<typeof useIsoLibrary>;
