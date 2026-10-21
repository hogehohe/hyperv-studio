import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type ThemePreference = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "hyperv-studio.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function readPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {
    // The app can still change appearance when browser storage is unavailable.
  }
  return "system";
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function applyTheme(theme: ResolvedTheme) {
  document.documentElement.dataset.theme = theme;
}

export function initializeAppearance() {
  const preference = readPreference();
  applyTheme(preference === "system" ? systemTheme() : preference);
}

export function useAppearance() {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);
  const [osTheme, setOsTheme] = useState<ResolvedTheme>(systemTheme);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [nativeError, setNativeError] = useState<string | null>(null);
  const nativeQueue = useRef<Promise<void>>(Promise.resolve());
  const theme = preference === "system" ? osTheme : preference;

  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const update = () => setOsTheme(query.matches ? "dark" : "light");
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useLayoutEffect(() => { applyTheme(theme); }, [theme]);

  useEffect(() => {
    if (!isTauri()) return;
    let current = true;
    setNativeError(null);
    // Keep native changes in order when the appearance is switched quickly.
    nativeQueue.current = nativeQueue.current.catch(() => {}).then(() =>
      getCurrentWindow().setTheme(preference === "system" ? null : preference),
    );
    void nativeQueue.current.catch(() => {
      if (current) setNativeError("タイトルバーの外観を変更できませんでした。アプリを再起動してお試しください。");
    });
    return () => { current = false; };
  }, [preference]);

  function changePreference(next: ThemePreference) {
    setPreference(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
      setSaveError(null);
    } catch {
      setSaveError("外観を変更しましたが、設定を保存できませんでした。次回起動時に選び直してください。");
    }
  }

  return { preference, changePreference, saveError, nativeError };
}
