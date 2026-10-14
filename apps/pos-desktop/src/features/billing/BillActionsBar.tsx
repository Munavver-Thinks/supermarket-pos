import { useEffect, useState } from "react";
import { isFractionalUom } from "@pos/business-logic";
import type { Customer } from "@pos/types";
import type { SessionContext } from "@shared/ipc.js";

import { useCartStore, type BillTab } from "../../store/cartStore.js";

import { ShortcutKey } from "./ShortcutHelpOverlay.js";
import { AssignCustomerModal } from "./AssignCustomerModal.js";
import { MergeBillModal } from "./MergeBillModal.js";
import { SplitBillModal } from "./SplitBillModal.js";
import { billingService } from "./services/billingService.js";

type OpenDialog = "merge" | "split" | "customer" | null;

interface BillActionsBarProps {
  context: SessionContext;
  customers: Record<string, Customer>;
  /** Tells the billing screen a dialog is up, so its keyboard shortcuts stand down. */
  onDialogChange: (open: boolean) => void;
  onCustomerAssigned: (customer: Customer) => void;
  onMessage: (message: string) => void;
  /** Opens the "Return item…" picker (F12) for the active bill. */
  onOpenReturn: () => void;
}

/**
 * Duplicate, merge, split and "customer for…" on the open bills. Autosave only covers the
 * active bill, so every action here saves (or drops) the drafts of the bills it touched —
 * otherwise the recovery window would offer a bill that was merged away, or lose a split.
 */
export function BillActionsBar({
  context,
  customers,
  onDialogChange,
  onCustomerAssigned,
  onMessage,
  onOpenReturn,
}: BillActionsBarProps): JSX.Element {
  const bills = useCartStore((s) => s.bills);
  const activeIndex = useCartStore((s) => s.activeIndex);
  const duplicateBill = useCartStore((s) => s.duplicateBill);
  const mergeBills = useCartStore((s) => s.mergeBills);
  const splitBill = useCartStore((s) => s.splitBill);
  const setCustomerForBill = useCartStore((s) => s.setCustomerForBill);

  const [open, setOpen] = useState<OpenDialog>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onDialogChange(open !== null);
  }, [open, onDialogChange]);

  const active = bills[activeIndex];
  const lines = active?.cart.lines ?? [];
  const onlyLine = lines.length === 1 ? lines[0] : undefined;
  // Something must stay behind: two lines, or one line with more than a single unit.
  const canSplit = lines.length > 1 || (onlyLine !== undefined && (onlyLine.qty > 1 || isFractionalUom(onlyLine.uom)));
  const canMerge = bills.length > 1 && lines.length > 0;

  function saveDraft(bill: BillTab | undefined): void {
    if (!bill || bill.cart.lines.length === 0) return;
    billingService
      .saveDraft({
        storeId: context.storeId,
        counterId: context.counterId,
        deviceId: context.deviceId,
        cart: bill.cart,
        label: bill.label,
      })
      .catch(() => undefined);
  }

  function close(): void {
    setOpen(null);
    setError(null);
  }

  function handleDuplicate(): void {
    if (!active) return;
    duplicateBill(activeIndex);
    const { bills: after, activeIndex: copyIndex } = useCartStore.getState();
    saveDraft(after[copyIndex]);
    onMessage(`${active.label} copied to a new bill.`);
  }

  function handleMerge(targetIndex: number): void {
    const source = bills[activeIndex];
    const target = bills[targetIndex];
    if (!source || !target) return;
    const refusal = mergeBills(activeIndex, targetIndex);
    if (refusal) {
      setError(refusal);
      return;
    }
    // The source bill no longer exists; its draft must not come back after a restart.
    billingService.deleteDraft(source.cart.clientTxnId).catch(() => undefined);
    const { bills: after, activeIndex: mergedIndex } = useCartStore.getState();
    saveDraft(after[mergedIndex]);
    close();
    onMessage(`${source.label} merged into ${target.label}.`);
  }

  function handleSplit(take: Record<string, number>): void {
    if (!active) return;
    const originalIndex = activeIndex;
    const refusal = splitBill(originalIndex, take);
    if (refusal) {
      setError(refusal);
      return;
    }
    const { bills: after, activeIndex: splitIndex } = useCartStore.getState();
    saveDraft(after[originalIndex]);
    saveDraft(after[splitIndex]);
    close();
    onMessage(`Items moved from ${active.label} to a new bill.`);
  }

  function handleAssign(billIndex: number, customer: Customer | null): void {
    const bill = bills[billIndex];
    if (!bill) return;
    if (customer) onCustomerAssigned(customer);
    setCustomerForBill(billIndex, customer?.id ?? null);
    // Autosave only follows the active bill; a waiting bill is saved here.
    if (billIndex !== activeIndex) saveDraft(useCartStore.getState().bills[billIndex]);
    close();
    onMessage(customer ? `${customer.name} attached to ${bill.label}.` : `Customer removed from ${bill.label}.`);
  }

  const customerNames = Object.fromEntries(Object.values(customers).map((c) => [c.id, c.name]));

  return (
    <div className="bill-actions-bar">
      <button className="btn btn-ghost" onClick={handleDuplicate} disabled={lines.length === 0}>
        Duplicate
      </button>
      <span title={canMerge ? undefined : "Needs another open bill, and items on this one"}>
        <button className="btn btn-ghost" onClick={() => setOpen("merge")} disabled={!canMerge}>
          Merge into…
        </button>
      </span>
      <span title={canSplit ? undefined : "Needs more than one item on the bill"}>
        <button className="btn btn-ghost" onClick={() => setOpen("split")} disabled={!canSplit}>
          Split…
        </button>
      </span>
      <button className="btn btn-ghost" onClick={() => setOpen("customer")}>
        Customer for…
      </button>
      <button className="btn btn-ghost" onClick={onOpenReturn}>
        Return item… <ShortcutKey action="returnAgainstBill" />
      </button>

      {open === "merge" && (
        <MergeBillModal bills={bills} sourceIndex={activeIndex} error={error} onMerge={handleMerge} onCancel={close} />
      )}
      {open === "split" && active && (
        <SplitBillModal label={active.label} cart={active.cart} error={error} onSplit={handleSplit} onCancel={close} />
      )}
      {open === "customer" && (
        <AssignCustomerModal
          storeId={context.storeId}
          bills={bills}
          initialIndex={activeIndex}
          customerNames={customerNames}
          onAssign={handleAssign}
          onCancel={close}
        />
      )}
    </div>
  );
}
