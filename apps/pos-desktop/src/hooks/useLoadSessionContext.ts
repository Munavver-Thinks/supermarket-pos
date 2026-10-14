import { useEffect } from "react";

import { sessionService } from "@/services/sessionService.js";
import { useSessionStore } from "@/store/sessionStore.js";

/** Fetches the store, counter, device and activation details once at startup. */
export function useLoadSessionContext(): void {
  const setContext = useSessionStore((s) => s.setContext);

  useEffect(() => {
    sessionService.getContext().then(setContext).catch(() => undefined);
  }, [setContext]);
}
