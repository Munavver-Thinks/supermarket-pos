import { useState } from "react";

import { Icon, LogoMark } from "@/components/Icon/index.js";
import { useSessionStore } from "@/store/sessionStore.js";

import { authService } from "../services/authService.js";

export function LoginScreen(): JSX.Element {
  const setUser = useSessionStore((s) => s.setUser);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await authService.login(username, password);
      if (result.ok && result.user) {
        setUser(result.user, result.usingDefaultPassword === true);
      } else {
        setError(result.error ?? "Login failed");
      }
    } catch {
      setError("Could not reach the local service. Please restart the app.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen login-split">
      <div className="login-brand">
        <LogoMark size={72} />
        <div className="login-brand-name">Supermarket POS</div>
        <div className="login-brand-tag">Fast, friendly billing for your counter.</div>
      </div>
      <div className="login-pane">
      <form className="login-card blueprint" onSubmit={handleSubmit}>
        <i className="corner tl" />
        <i className="corner tr" />
        <i className="corner bl" />
        <i className="corner br" />
        <h1>Sign in / உள்நுழை</h1>
        {/* Bilingual and fixed, not toggled — nothing is known about the cashier's language
            preference before they've signed in (see uiStrings.ts's documented scope). */}
        <div className="field">
          <label htmlFor="username">Username / பயனர் பெயர்</label>
          <input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="password">Password / கடவுச்சொல்</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <div className="error-text">
            <Icon name="alert" size={24} />
            <span>{error}</span>
          </div>
        )}
        <button className="primary-btn login-submit" type="submit" disabled={loading}>
          {loading ? "Signing in... / உள்நுழைகிறது..." : "Sign in / உள்நுழை"}
        </button>
      </form>
      </div>
    </div>
  );
}
