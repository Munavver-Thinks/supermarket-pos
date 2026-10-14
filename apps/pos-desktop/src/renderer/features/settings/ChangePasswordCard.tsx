import { useState } from "react";

import { BlueprintCard } from "../../components/BlueprintCard.js";
import { Icon } from "../../components/icons.js";
import { useSessionStore } from "../../store/sessionStore.js";

/** Lets whoever is signed in change their own password. The current one is always asked for. */
export function ChangePasswordCard(): JSX.Element {
  const user = useSessionStore((s) => s.user);
  const usingDefaultPassword = useSessionStore((s) => s.usingDefaultPassword);
  const setUsingDefaultPassword = useSessionStore((s) => s.setUsingDefaultPassword);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!user) return;
    if (next !== confirm) {
      setMessage({ text: "The two new passwords don't match.", error: true });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const result = await window.api.users.changeOwnPassword({
        actingUserId: user.id,
        currentPassword: current,
        newPassword: next,
      });
      if (!result.ok) {
        setMessage({ text: result.error ?? "Could not change the password.", error: true });
        return;
      }
      setCurrent("");
      setNext("");
      setConfirm("");
      setUsingDefaultPassword(false);
      setMessage({ text: "Password changed. Use the new one next time you sign in.", error: false });
    } catch {
      setMessage({ text: "Could not reach the local service. Please retry.", error: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <BlueprintCard>
      <form onSubmit={handleSubmit} autoComplete="off">
        <h2>Change your password</h2>
        {usingDefaultPassword && (
          <div className="settings-warn-note">
            <Icon name="lock" size={24} />
            <span>
              You signed in with the default password <code>admin123</code>. Anyone who knows it can sign in as the
              owner — change it now.
            </span>
          </div>
        )}
        <div className="field">
          <label htmlFor="pw-current">Current password</label>
          <input
            id="pw-current"
            type="password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <div className="field">
          <label htmlFor="pw-new">New password</label>
          <input
            id="pw-new"
            type="password"
            required
            minLength={6}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="At least 6 characters, not your username"
            autoComplete="new-password"
          />
        </div>
        <div className="field">
          <label htmlFor="pw-confirm">New password again</label>
          <input
            id="pw-confirm"
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <button className="primary-btn" type="submit" disabled={saving || !current || next.length < 6}>
          {saving ? "Saving…" : "Change password"}
        </button>
        {message && (
          <div className={message.error ? "error-text settings-message" : "settings-message"}>{message.text}</div>
        )}
      </form>
    </BlueprintCard>
  );
}
