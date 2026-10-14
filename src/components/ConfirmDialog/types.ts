export interface ConfirmOptions {
  title: string;
  /** Body text; newlines and bullets are kept as written. */
  message?: string;
  /** Orange notice with an alert icon (the thing that will be lost or replaced). */
  notice?: string;
  /** Shown in bold at the start of the notice (e.g. the backup's name). */
  noticeLead?: string;
  /** Small muted line under the body. */
  note?: string;
  confirmLabel: string;
  cancelLabel: string;
  /** "danger" (default) paints the confirm button tomato; "primary" is the normal button. */
  tone?: "danger" | "primary";
  width?: number;
}

export interface ConfirmDialogProps {
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}
