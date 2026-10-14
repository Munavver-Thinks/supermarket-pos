import { useEffect } from "react";

import { useSessionStore } from "@/store/sessionStore.js";

/** Mirrors the browser's online/offline events into the session store (drives the offline banner). */
export function useOnlineStatus(): void {
  const setOnline = useSessionStore((s) => s.setOnline);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [setOnline]);
}
