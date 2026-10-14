import { create } from "zustand";
import type { ActivationInfo, User } from "@pos/types";
import type { SessionContext } from "@shared/ipc.js";

interface SessionState {
  context: SessionContext | null;
  user: User | null;
  isOnline: boolean;
  /** Signed in with the seeded admin / admin123 — the shell warns until it's changed. */
  usingDefaultPassword: boolean;
  /**
   * Overrides context.activation the moment the activation screen succeeds, so the gate drops
   * immediately without waiting on another round trip to session:getContext.
   */
  activationOverride: ActivationInfo | null;
  setContext: (context: SessionContext) => void;
  /** Signing out (null) also clears the default-password warning. */
  setUser: (user: User | null, usingDefaultPassword?: boolean) => void;
  setUsingDefaultPassword: (value: boolean) => void;
  setOnline: (online: boolean) => void;
  setActivationOverride: (activation: ActivationInfo | null) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  context: null,
  user: null,
  isOnline: navigator.onLine,
  usingDefaultPassword: false,
  activationOverride: null,
  setContext: (context) => set({ context }),
  setUser: (user, usingDefaultPassword = false) => set({ user, usingDefaultPassword: user ? usingDefaultPassword : false }),
  setUsingDefaultPassword: (usingDefaultPassword) => set({ usingDefaultPassword }),
  setOnline: (isOnline) => set({ isOnline }),
  setActivationOverride: (activationOverride) => set({ activationOverride }),
}));
