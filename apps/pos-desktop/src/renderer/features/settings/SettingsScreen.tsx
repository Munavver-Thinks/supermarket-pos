import { useCallback, useEffect, useRef, useState } from "react";
import { auditActionLabel, canChangeStoreSettings, canViewAuditLog, describeAuditEntry } from "@pos/business-logic";
import type { ActivationInfo, AuditActivityEntry } from "@pos/types";

import { BlueprintCard } from "../../components/BlueprintCard.js";
import { useConfirm } from "../../components/ConfirmDialog.js";
import { useSessionStore } from "../../store/sessionStore.js";
import type { BackupFile, NegativeStockPolicy, ReceiptLanguage } from "../../../shared/ipc.js";
import { ActivationForm } from "../auth/ActivationForm.js";

import { ChangePasswordCard } from "./ChangePasswordCard.js";
import { AppearanceCard } from "./AppearanceCard.js";
import { ExpirySettingsCard } from "./ExpirySettingsCard.js";
import { LabelSettingsCard } from "./LabelSettingsCard.js";
import { LanguageCard } from "./LanguageCard.js";

/** Wording per the activation plan: "Activated" / "Not activated" only — never "protected",
 * "secure" or "licensed copy verified online". Activation is a deterrent, not real protection
 * (see activation.ts and the README); this screen must not overstate what it does. */
const ACTIVATION_STATUS_LABEL: Record<ActivationInfo["status"], string> = {
  activated: "Activated",
  unactivated: "Not activated",
  not_activated_legacy: "Not activated",
  developer: "Developer build — activation not enforced",
};

/** The pill colour that goes with each activation status. */
const ACTIVATION_PILL: Record<ActivationInfo["status"], string> = {
  activated: "ok",
  unactivated: "warn",
  not_activated_legacy: "warn",
  developer: "info",
};

/** Entries per page of the activity log; a full page means there may be older ones. */
const ACTIVITY_PAGE = 50;

const STOCK_POLICY_OPTIONS: Array<{ value: NegativeStockPolicy; label: string; detail: string }> = [
  {
    value: "warn",
    label: "Warn the cashier",
    detail: "The sale goes through, and the cart shows which items are short so the count gets fixed. Recommended.",
  },
  {
    value: "block",
    label: "Block the sale",
    detail: "Checkout is refused until the quantity is lowered or the stock is corrected. For shops that keep tight counts.",
  },
  {
    value: "allow",
    label: "Allow silently",
    detail: "Sell regardless and show nothing. Stock can drift below zero unnoticed.",
  },
];

const RECEIPT_LANGUAGE_OPTIONS: Array<{ value: ReceiptLanguage; label: string; detail: string }> = [
  {
    value: "bilingual",
    label: "English and Tamil",
    detail: "Each item's English name, with its Tamil name beneath. Recommended.",
  },
  {
    value: "tamil_first",
    label: "Tamil first",
    detail: "The Tamil name on top, with the English name beneath.",
  },
  {
    value: "english",
    label: "English only",
    detail: "Tamil names are left off the receipt.",
  },
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SettingsScreen(): JSX.Element {
  const context = useSessionStore((s) => s.context);
  const user = useSessionStore((s) => s.user);
  const confirm = useConfirm();
  const confirmingRef = useRef(false);
  const [printers, setPrinters] = useState<string[]>([]);
  const [seedingCatalog, setSeedingCatalog] = useState(false);
  const [catalogMessage, setCatalogMessage] = useState<string | null>(null);

  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [backingUp, setBackingUp] = useState(false);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);

  const [activation, setActivation] = useState<ActivationInfo | null>(null);
  useEffect(() => {
    if (context) setActivation(context.activation);
  }, [context]);

  const canRestore = user?.role === "owner";
  const canEditStockPolicy = user ? canChangeStoreSettings(user.role) : false;
  const canSeeActivity = user ? canViewAuditLog(user.role) : false;

  const [activity, setActivity] = useState<AuditActivityEntry[]>([]);
  const [activityHasMore, setActivityHasMore] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  const loadActivity = useCallback(
    async (beforeIso: string | null) => {
      if (!user || !canViewAuditLog(user.role)) return;
      setActivityLoading(true);
      setActivityError(null);
      const result = await window.api.audit.list(user.id, { limit: ACTIVITY_PAGE, beforeIso });
      setActivityLoading(false);
      if (!Array.isArray(result)) {
        setActivityError(result.error);
        return;
      }
      setActivity((prev) => (beforeIso ? [...prev, ...result] : result));
      setActivityHasMore(result.length === ACTIVITY_PAGE);
    },
    [user],
  );

  useEffect(() => {
    void loadActivity(null);
  }, [loadActivity]);

  const [stockPolicy, setStockPolicy] = useState<NegativeStockPolicy | null>(null);
  const [stockPolicyMessage, setStockPolicyMessage] = useState<string | null>(null);

  useEffect(() => {
    window.api.storeSettings.getNegativeStockPolicy().then(setStockPolicy).catch(() => undefined);
  }, []);

  async function handleStockPolicyChange(next: NegativeStockPolicy): Promise<void> {
    if (!user || !stockPolicy || next === stockPolicy) return;
    const previous = stockPolicy;
    setStockPolicy(next);
    setStockPolicyMessage(null);
    const result = await window.api.storeSettings.setNegativeStockPolicy(next, user.id);
    if (!result.ok) {
      // Put the control back, so it never shows a rule that isn't actually in force.
      setStockPolicy(previous);
      setStockPolicyMessage(result.error ?? "Could not save the setting.");
      return;
    }
    setStockPolicyMessage("Saved. Applies to the next bill.");
  }

  const [receiptLanguage, setReceiptLanguage] = useState<ReceiptLanguage | null>(null);
  const [receiptLanguageMessage, setReceiptLanguageMessage] = useState<string | null>(null);

  useEffect(() => {
    window.api.storeSettings.getReceiptLanguage().then(setReceiptLanguage).catch(() => undefined);
  }, []);

  async function handleReceiptLanguageChange(next: ReceiptLanguage): Promise<void> {
    if (!user || !receiptLanguage || next === receiptLanguage) return;
    const previous = receiptLanguage;
    setReceiptLanguage(next);
    setReceiptLanguageMessage(null);
    const result = await window.api.storeSettings.setReceiptLanguage(next, user.id);
    if (!result.ok) {
      // Put the control back, so it never shows a setting that isn't actually in force.
      setReceiptLanguage(previous);
      setReceiptLanguageMessage(result.error ?? "Could not save the setting.");
      return;
    }
    setReceiptLanguageMessage("Saved. Applies to the next receipt printed.");
  }

  useEffect(() => {
    window.api.printer.listPrinters().then(setPrinters).catch(() => undefined);
  }, []);

  const refreshBackups = useCallback(() => {
    window.api.backup
      .list()
      .then(setBackups)
      .catch(() => setBackups([]));
  }, []);

  useEffect(refreshBackups, [refreshBackups]);

  async function handleBackupNow(): Promise<void> {
    setBackingUp(true);
    setBackupMessage(null);
    try {
      const result = await window.api.backup.run();
      setBackupMessage(
        result.ok && result.backup
          ? `Backed up — ${formatSize(result.backup.sizeBytes)} saved.`
          : (result.error ?? "Could not create the backup."),
      );
      refreshBackups();
    } catch {
      setBackupMessage("Could not reach the local service. Please retry.");
    } finally {
      setBackingUp(false);
    }
  }

  async function handleRestore(backup: BackupFile): Promise<void> {
    if (!user || confirmingRef.current) return;
    confirmingRef.current = true;
    let ok = false;
    try {
      ok = await confirm({
        title: "Restore backup?",
        noticeLead: formatWhen(backup.createdAt),
        notice: `(${formatSize(backup.sizeBytes)}) will replace everything on this computer. Bills since then will be lost.`,
        note: "The app restarts after restoring. Only an owner can do this.",
        cancelLabel: "Keep current data",
        confirmLabel: "Restore",
        width: 520,
      });
    } finally {
      confirmingRef.current = false;
    }
    if (!ok) return;
    const name = backup.name;
    setBackupMessage(null);
    // On success the app restarts, so nothing after this resolves.
    const result = await window.api.backup.restore(name, user.id);
    if (!result.ok) {
      setBackupMessage(result.error ?? "Could not restore that backup.");
    }
  }

  async function handleSeedDemoCatalog(): Promise<void> {
    if (!context || !user) return;
    setSeedingCatalog(true);
    setCatalogMessage(null);
    try {
      const result = await window.api.catalog.seedDemo(context.storeId, user.id);
      if (!result.ok) {
        setCatalogMessage(result.error ?? "Could not load the demo catalog.");
      } else if (result.seeded) {
        setCatalogMessage(`Loaded ${result.productsCreated} demo products with opening stock — ready to bill.`);
      } else {
        setCatalogMessage("This store already has products — nothing was changed.");
      }
    } catch {
      setCatalogMessage("Could not reach the local service. Please retry.");
    } finally {
      setSeedingCatalog(false);
    }
  }

  return (
    <div className="screen-section settings-screen">
      <div className="settings-grid">
        <BlueprintCard>
          <h2>Device</h2>
          <table className="table settings-device">
            <tbody>
              <tr>
                <td>Organization ID</td>
                <td>{context?.organizationId}</td>
              </tr>
              <tr>
                <td>Store ID</td>
                <td>{context?.storeId}</td>
              </tr>
              <tr>
                <td>Device ID</td>
                <td>{context?.deviceId}</td>
              </tr>
              <tr>
                <td>Counter</td>
                <td>{context?.counterId}</td>
              </tr>
              <tr>
                <td>Bill prefix</td>
                <td>{context?.billNoPrefix}</td>
              </tr>
              {activation && (
                <tr>
                  <td>Activation</td>
                  <td>
                    <span className={`pill ${ACTIVATION_PILL[activation.status]}`}>
                      {ACTIVATION_STATUS_LABEL[activation.status]}
                    </span>
                    {activation.status === "activated" && activation.licenseId && (
                      <span className="text-muted settings-license">{`· ${activation.licenseId}`}</span>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {activation?.status === "not_activated_legacy" && (
            <div className="settings-activation">
              <ActivationForm activation={activation} onActivated={setActivation} />
            </div>
          )}
        </BlueprintCard>

        <BlueprintCard>
          <h2>Printers detected</h2>
          <ul className="settings-printers">
            {printers.map((name) => (
              <li key={name}>{name}</li>
            ))}
            {printers.length === 0 && <li className="text-muted">No printers detected.</li>}
          </ul>
        </BlueprintCard>

        <BlueprintCard>
          <h2>Backup</h2>
          <p className="note settings-note">
            A copy of the whole database is taken automatically once a day when the app opens, and the last 14 are kept.
            Take one by hand before anything risky — a big stock correction, a price change across the shop.
          </p>
          <div className="tools-row">
            <button className="btn primary-btn" onClick={handleBackupNow} disabled={backingUp}>
              {backingUp ? "Backing up…" : "Back up now"}
            </button>
            <span className="note">
              {backups.length > 0 ? `Last backup ${formatWhen(backups[0]!.createdAt)}` : "No backups yet"}
            </span>
          </div>
          {backupMessage && <div className="settings-message">{backupMessage}</div>}

          {backups.length > 0 && (
            <table className="table settings-backup-table">
              <thead>
                <tr>
                  <th>Taken</th>
                  <th>Size</th>
                  {canRestore && <th></th>}
                </tr>
              </thead>
              <tbody>
                {backups.map((backup) => (
                  <tr key={backup.name}>
                    <td>{formatWhen(backup.createdAt)}</td>
                    <td>{formatSize(backup.sizeBytes)}</td>
                    {canRestore && (
                      <td className="r">
                        <button className="btn btn-secondary" onClick={() => void handleRestore(backup)}>
                          Restore
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!canRestore && <div className="note settings-foot">Only an owner can restore a backup.</div>}
        </BlueprintCard>

        <BlueprintCard>
          <h2>Selling beyond recorded stock</h2>
          <p className="note settings-note">
            What happens when a bill asks for more than the shop&rsquo;s records say is on the shelf — usually a missed
            purchase entry or a loose-weight item.
          </p>
          <fieldset disabled={!canEditStockPolicy || stockPolicy === null} className="settings-options">
            <legend className="note">When stock would go below zero</legend>
            {STOCK_POLICY_OPTIONS.map((option) => (
              <label key={option.value} htmlFor={`stock-policy-${option.value}`} className="settings-option">
                <input
                  id={`stock-policy-${option.value}`}
                  type="radio"
                  name="stock-policy"
                  value={option.value}
                  checked={stockPolicy === option.value}
                  onChange={() => void handleStockPolicyChange(option.value)}
                />
                <span>
                  <strong>{option.label}</strong>
                  <span className="note settings-option-detail">{option.detail}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {stockPolicyMessage && <div className="settings-message">{stockPolicyMessage}</div>}
          {!canEditStockPolicy && <div className="note settings-foot">Only an owner or manager can change this.</div>}
        </BlueprintCard>

        <ExpirySettingsCard />

        <LabelSettingsCard printers={printers} />

        <BlueprintCard>
          <h2>Receipt language</h2>
          <p className="note settings-note">
            Which product names are printed on the bill. Items that have no Tamil name print in English whatever is
            chosen here.
          </p>
          <fieldset disabled={!canEditStockPolicy || receiptLanguage === null} className="settings-options">
            <legend className="note">Product names on printed receipts</legend>
            {RECEIPT_LANGUAGE_OPTIONS.map((option) => (
              <label key={option.value} htmlFor={`receipt-language-${option.value}`} className="settings-option">
                <input
                  id={`receipt-language-${option.value}`}
                  type="radio"
                  name="receipt-language"
                  value={option.value}
                  checked={receiptLanguage === option.value}
                  onChange={() => void handleReceiptLanguageChange(option.value)}
                />
                <span>
                  <strong>{option.label}</strong>
                  <span className="note settings-option-detail">{option.detail}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {receiptLanguageMessage && <div className="settings-message">{receiptLanguageMessage}</div>}
          {!canEditStockPolicy && <div className="note settings-foot">Only an owner or manager can change this.</div>}
        </BlueprintCard>

        {canSeeActivity && (
          <BlueprintCard className="settings-wide">
            <div className="settings-card-head">
              <h2>Activity log</h2>
              <button
                className="btn btn-secondary settings-head-btn"
                onClick={() => void loadActivity(null)}
                disabled={activityLoading}
              >
                Refresh
              </button>
            </div>
            <p className="note settings-note">
              Every bill, return, discount, stock correction, cost change, khata payment and drawer count, with who did
              it. Entries can&rsquo;t be edited or deleted.
            </p>
            {activityError && <div className="error-text">{activityError}</div>}
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>What</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.map((entry) => (
                    <tr key={entry.id}>
                      <td className="text-muted settings-nowrap">{formatWhen(entry.createdAt)}</td>
                      <td>{entry.userName ?? "—"}</td>
                      <td className="settings-nowrap">{auditActionLabel(entry.action)}</td>
                      <td>
                        {describeAuditEntry(entry) || <span className="text-muted">—</span>}
                        {entry.reason && <div className="note">{entry.reason}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {activity.length === 0 && !activityLoading && !activityError && (
              <div className="empty-state settings-empty">Nothing recorded yet.</div>
            )}
            {activityHasMore && (
              <button
                className="btn btn-secondary settings-load-more"
                disabled={activityLoading}
                onClick={() => void loadActivity(activity[activity.length - 1]?.createdAt ?? null)}
              >
                {activityLoading ? "Loading…" : "Load older"}
              </button>
            )}
          </BlueprintCard>
        )}

        <BlueprintCard>
          <h2>Demo catalog</h2>
          <p className="note settings-note">
            Loads a 90-product Tamil-bilingual kirana catalog (rice, dals, oils, spices, vegetables, fruits, dairy,
            snacks, beverages, household) with real opening stock, so you can start billing right away. Safe to click
            more than once — it only runs once and does nothing if this store already has products.
          </p>
          <button className="btn btn-secondary" onClick={handleSeedDemoCatalog} disabled={seedingCatalog}>
            {seedingCatalog ? "Loading…" : "Load demo catalog"}
          </button>
          {catalogMessage && <div className="settings-message">{catalogMessage}</div>}
        </BlueprintCard>

        <ChangePasswordCard />

        <LanguageCard />

        <AppearanceCard />
      </div>
    </div>
  );
}
