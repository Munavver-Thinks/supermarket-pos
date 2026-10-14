import { translate, type UiStringKey } from "@pos/business-logic";

import { useUiLanguageStore } from "@/store/uiLanguageStore.js";

/** `t(key)` bound to the current language, with the same `{name}` placeholder support as
 * `translate` itself. */
export function useT(): (key: UiStringKey, params?: Record<string, string | number>) => string {
  const language = useUiLanguageStore((s) => s.language);
  return (key, params) => translate(key, language, params);
}
