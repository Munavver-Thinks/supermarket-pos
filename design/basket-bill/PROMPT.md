# Prompt for Claude Code (VS Code)

Open the `billing` folder in VS Code, start Claude Code, and paste this:

---

Restyle the Supermarket POS renderer (`apps/pos-desktop/src/renderer`) to the Basket Bill design.

Read these first:

- @design/basket-bill/README.md
- @design/basket-bill/HANDOFF.md
- @design/basket-bill/tokens.css

The target look for every screen and popup is in `design/basket-bill/wireframes/` (S01–S20 screens, P01–P23 popups). Each file is plain HTML with an explanatory comment at the top.

Work through HANDOFF.md one phase at a time, starting with Phase 1. After each phase:

- run `pnpm typecheck`, `pnpm lint` and `pnpm test` and fix anything they report
- show me a short summary of the files changed
- wait for my OK before starting the next phase

This is a visual change only. Don't change business logic, IPC, money handling, element ids used by shortcuts, or the app's F-key and Ctrl shortcuts. The app runs offline, so don't load fonts or anything else from the internet.

---

Tips:

- To check one screen, ask: "Compare the billing screen to `design/basket-bill/wireframes/S04Billing.html` and list what still differs."
- Phase 6 (per-user theme) is a real feature with IPC and storage, so ask for it separately once the look is done.
- The wireframe gallery is `design/basket-bill/wireframes/index.html`. Open it in a browser and use the Theme menu to see all five themes.
