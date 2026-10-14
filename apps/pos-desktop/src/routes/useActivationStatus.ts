import type { ActivationStatus } from "@pos/types";

import { useSessionStore } from "@/store/sessionStore.js";

/**
 * The device's activation status: the override set the moment the activation screen succeeds
 * wins over the one in the session context. Until the context has loaded the device counts as
 * "activated" so nothing redirects; the router shows its start-up screen in that window.
 */
export function useActivationStatus(): ActivationStatus {
  return useSessionStore((s) => (s.activationOverride ?? s.context?.activation)?.status ?? "activated");
}
