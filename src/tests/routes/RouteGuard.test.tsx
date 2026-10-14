import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ActivationInfo, User } from "@pos/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useSessionStore } from "@/store/sessionStore.js";
import { RouteGuard } from "@/routes/RouteGuard.js";
import { APP_ROUTES } from "@/routes/routeConfig.js";
import type { AppRoute } from "@/routes/routeConfig.js";

function activation(status: ActivationInfo["status"]): ActivationInfo {
  return { status, requestCode: "X", licenseId: null, storeName: null, issuedAt: null, reason: null };
}

function userWithRole(role: User["role"]): User {
  return { id: "u1", username: "u", displayName: "U", role } as User;
}

function setSession(status: ActivationInfo["status"], user: User | null): void {
  useSessionStore.setState({
    context: { activation: activation(status) } as never,
    activationOverride: null,
    user,
  });
}

const found = APP_ROUTES.find((r) => r.id === "reports");
if (!found) throw new Error("reports route missing from APP_ROUTES");
const reports: AppRoute = found;

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/activate" element={<div>activate-screen</div>} />
        <Route path="/login" element={<div>login-screen</div>} />
        <Route path="/dashboard" element={<div>dashboard-screen</div>} />
        <Route
          path="/reports"
          element={
            <RouteGuard route={reports}>
              <div>reports-screen</div>
            </RouteGuard>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RouteGuard", () => {
  beforeEach(() => setSession("activated", null));
  afterEach(cleanup);

  it("sends an unactivated device to activation, even when a user is set", () => {
    setSession("unactivated", userWithRole("owner"));
    renderAt("/reports");
    expect(screen.getByText("activate-screen")).toBeTruthy();
  });

  it("sends a signed-out visitor to login", () => {
    renderAt("/reports");
    expect(screen.getByText("login-screen")).toBeTruthy();
  });

  it("bounces a role without access to the dashboard", () => {
    setSession("activated", userWithRole("cashier"));
    renderAt("/reports");
    expect(screen.getByText("dashboard-screen")).toBeTruthy();
  });

  it("renders the page for an allowed role", () => {
    setSession("activated", userWithRole("manager"));
    renderAt("/reports");
    expect(screen.getByText("reports-screen")).toBeTruthy();
  });

  it("lets legacy and developer installs through without activation", () => {
    for (const status of ["not_activated_legacy", "developer"] as const) {
      cleanup();
      setSession(status, userWithRole("owner"));
      renderAt("/reports");
      expect(screen.getByText("reports-screen")).toBeTruthy();
    }
  });

  it("honours the activation override set when the activation screen succeeds", () => {
    setSession("unactivated", userWithRole("owner"));
    useSessionStore.setState({ activationOverride: activation("activated") });
    renderAt("/reports");
    expect(screen.getByText("reports-screen")).toBeTruthy();
  });
});
