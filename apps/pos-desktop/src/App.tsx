import { useApplyTheme } from "@/hooks/useApplyTheme.js";
import { useGlobalErrorReporting } from "@/hooks/useGlobalErrorReporting.js";
import { useLoadSessionContext } from "@/hooks/useLoadSessionContext.js";
import { useLoadUiLanguage } from "@/hooks/useLoadUiLanguage.js";
import { useOnlineStatus } from "@/hooks/useOnlineStatus.js";
import { AppRouter } from "@/routes/index.js";
import { useSessionStore } from "@/store/sessionStore.js";

/**
 * App root. Every hook here runs before the activation and sign-in screens on purpose — a
 * crash, an offline blip or the saved language can matter before anyone has signed in — so
 * none of them lives in the signed-in shell (routes/AppLayout).
 */
export function App(): JSX.Element {
  const userId = useSessionStore((s) => s.user?.id ?? null);
  useLoadUiLanguage();
  useApplyTheme(userId);
  useLoadSessionContext();
  useGlobalErrorReporting();
  useOnlineStatus();

  return <AppRouter />;
}
