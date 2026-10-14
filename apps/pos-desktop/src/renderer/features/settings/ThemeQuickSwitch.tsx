import { useEffect, useRef, useState, type RefObject } from "react";

import { Icon } from "../../components/icons.js";
import { useModalKeyboard } from "../../components/useModalKeyboard.js";
import { useSessionStore } from "../../store/sessionStore.js";
import { useThemeStore } from "../../theme/useTheme.js";

import { currentChoice, THEME_CHOICES, ThemeSwatch } from "./ThemeTiles.js";

interface ThemeQuickSwitchProps {
  onMoreOptions: () => void;
}

/**
 * The sun/moon button in the rail footer and the small list it opens (wireframe P23). Picking a
 * row saves straight away; "More options…" opens the full Appearance window.
 */
export function ThemeQuickSwitch({ onMoreOptions }: ThemeQuickSwitchProps): JSX.Element {
  const user = useSessionStore((s) => s.user);
  const preference = useThemeStore((s) => s.preference);
  const resolved = useThemeStore((s) => s.resolved);
  const setPreference = useThemeStore((s) => s.setPreference);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const dark = resolved === "dark" || resolved === "vivid-night";
  const current = currentChoice(preference);

  function close(returnFocus: boolean): void {
    setOpen(false);
    setError(null);
    if (returnFocus) buttonRef.current?.focus();
  }

  async function choose(next: typeof preference): Promise<void> {
    if (!user) return;
    setError(null);
    const result = await setPreference(next, user.id);
    if (!result.ok) setError(result.error ?? "Could not save the setting.");
    else close(true);
  }

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
      }
    }
    function onPointerDown(e: MouseEvent): void {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close(false);
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="rail-theme"
        aria-label="Change theme"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Change theme"
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <Icon name={dark ? "moon" : "sun"} size={16} />
      </button>
      {open && (
        <QuickSwitchPopover
          popoverRef={popoverRef}
          selectedTheme={preference.highContrast ? "contrast" : current.theme}
          error={error}
          onPickChoice={(index) => {
            const choice = THEME_CHOICES[index]!;
            void choose({ set: choice.set, mode: choice.mode, highContrast: false });
          }}
          onPickContrast={() => void choose({ ...preference, highContrast: true })}
          onMore={() => {
            close(false);
            onMoreOptions();
          }}
        />
      )}
    </>
  );
}

interface QuickSwitchPopoverProps {
  popoverRef: RefObject<HTMLDivElement>;
  selectedTheme: string;
  error: string | null;
  onPickChoice: (index: number) => void;
  onPickContrast: () => void;
  onMore: () => void;
}

function QuickSwitchPopover(props: QuickSwitchPopoverProps): JSX.Element {
  useModalKeyboard(props.popoverRef);
  return (
    <div
      className="modal-card theme-quick"
      role="dialog"
      aria-label="Quick switch"
      ref={props.popoverRef}
    >
      <div className="appearance-kicker">Quick switch</div>
      {THEME_CHOICES.map((choice, index) => (
        <button
          key={choice.theme}
          type="button"
          className={"theme-quick-row" + (props.selectedTheme === choice.theme ? " selected" : "")}
          aria-pressed={props.selectedTheme === choice.theme}
          onClick={() => props.onPickChoice(index)}
        >
          <ThemeSwatch theme={choice.theme} />
          <b>{choice.label}</b>
          {props.selectedTheme === choice.theme && <span className="theme-quick-check">{"✓"}</span>}
        </button>
      ))}
      <button
        type="button"
        className={"theme-quick-row" + (props.selectedTheme === "contrast" ? " selected" : "")}
        aria-pressed={props.selectedTheme === "contrast"}
        onClick={props.onPickContrast}
      >
        <ThemeSwatch theme="contrast" />
        <b>High contrast</b>
        {props.selectedTheme === "contrast" && <span className="theme-quick-check">{"✓"}</span>}
      </button>
      {props.error && <div className="error-text">{props.error}</div>}
      <button type="button" className="btn btn-ghost theme-quick-more" onClick={props.onMore}>
        More options…
      </button>
    </div>
  );
}
