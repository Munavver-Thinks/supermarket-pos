import { useContext } from "react";

import { ConfirmContext } from "./ConfirmContext.js";
import type { ConfirmFn } from "./types.js";

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return confirm;
}
