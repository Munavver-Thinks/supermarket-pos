import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog/index.js";

import { ConfirmContext } from "./ConfirmContext.js";
import type { ConfirmFn, Pending } from "./types.js";

/**
 * Themed replacement for the browser's native confirm box. One dialog at a time: a call made while another is
 * open waits its turn (promise chain), so every caller still gets its own answer.
 */
export function ConfirmProvider({ children }: { children: ReactNode }): JSX.Element {
  const [pending, setPending] = useState<Pending | null>(null);
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const nextKey = useRef(0);

  const confirm = useCallback<ConfirmFn>((options) => {
    const run = (): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        nextKey.current += 1;
        setPending({
          key: nextKey.current,
          options,
          resolve: (ok) => {
            setPending(null);
            resolve(ok);
          },
        });
      });
    const result = tail.current.then(run);
    tail.current = result;
    return result;
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && <ConfirmDialog key={pending.key} options={pending.options} resolve={pending.resolve} />}
    </ConfirmContext.Provider>
  );
}
