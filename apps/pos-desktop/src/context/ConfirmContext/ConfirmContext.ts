import { createContext } from "react";

import type { ConfirmFn } from "./types.js";

export const ConfirmContext = createContext<ConfirmFn | null>(null);
