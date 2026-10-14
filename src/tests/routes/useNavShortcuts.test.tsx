import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ActivationInfo, User } from "@pos/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useSessionStore } from "@/store/sessionStore.js";
import { useNavShortcuts } from "@/routes/useNavShortcuts.js";

function Probe(): JSX.Element {
  useNavShortcuts();
  return <div data-testid="path">{useLocation().pathname}</div>;
}

function mount(role: User["role"] | null): void {
  const activation = { status: "activated" } as ActivationInfo;
  useSessionStore.setState({
    context: { activation } as never,
    activationOverride: null,
    user: role ? ({ id: "u", username: "u", displayName: "U", role } as User) : null,
  });
  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Probe />
    </MemoryRouter>,
  );
}

function press(key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true, ...init }));
  });
}

const path = (): string => screen.getByTestId("path").textContent ?? "";

describe("useNavShortcuts", () => {
  beforeEach(() => document.body.replaceChildren());
  afterEach(cleanup);

  it("jumps to the screen a Ctrl+letter is bound to", () => {
    mount("owner");
    press("b");
    expect(path()).toBe("/billing");
    press("o");
    expect(path()).toBe("/reports");
    press(",");
    expect(path()).toBe("/settings");
  });

  it("never reaches a screen the role cannot open", () => {
    mount("cashier");
    press("o"); // reports: owner and manager only
    expect(path()).toBe("/dashboard");
    press("b"); // billing: every role
    expect(path()).toBe("/billing");
  });

  it("does nothing while a modal dialog is open", () => {
    mount("owner");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    press("b");
    expect(path()).toBe("/dashboard");
  });

  it("does nothing when nobody is signed in", () => {
    mount(null);
    press("b");
    expect(path()).toBe("/dashboard");
  });

  it("ignores a plain letter without Ctrl", () => {
    mount("owner");
    press("b", { ctrlKey: false });
    expect(path()).toBe("/dashboard");
  });
});
