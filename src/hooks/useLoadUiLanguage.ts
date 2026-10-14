import { useEffect } from "react";

import { useUiLanguageStore } from "@/store/uiLanguageStore.js";

/** Loads the saved language once and keeps `<html lang>` in sync — screen readers and the
 * `[lang="ta"]` font-stack rule in styles.css both depend on it being correct. Call once,
 * from the app shell. */
export function useLoadUiLanguage(): void {
  const load = useUiLanguageStore((s) => s.load);
  const language = useUiLanguageStore((s) => s.language);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
}
