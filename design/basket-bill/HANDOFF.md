# Implementing the Basket Bill design in Supermarket POS

Plan for Claude Code. Restyle the renderer of `apps/pos-desktop` to match `wireframes/`, using `tokens.css`. **This is a visual change only.**

## Ground rules

- **Do not change behaviour.** Keep every IPC call, store, validation, money handling (integer paise), autosave, crash recovery and permission check exactly as it is.
- **Keep the app's own keyboard shortcuts** (`packages/business-logic/src/billingShortcuts.ts`, `navShortcuts.ts`). Some generic counter mock-ups in the online design system use different F-keys; ignore those. The wireframes in `wireframes/` already use the app's real keys.
- Keep every element id that shortcuts focus (`BILLING_FOCUS_IDS`, `lineQtyInputId`, `paymentFieldId`), every `role="dialog"`, and `useModalKeyboard`.
- Keep the Tamil font rule (`[lang="ta"]`, `:lang(ta)`) and the bilingual login.
- The app is offline. Do not load fonts from Google. Either keep the bundled Barlow, or add Lexend `.woff2` files (SIL Open Font License) to `src/renderer/assets/fonts/` and declare them with `@font-face` like Barlow.
- After every phase: `pnpm typecheck`, `pnpm lint` (zero warnings), `pnpm test`, then `pnpm dev` and check the screens against the wireframes.

## Phase 1: tokens (every screen picks them up)

1. Paste `tokens.css` at the top of `src/renderer/styles.css`, replacing the current `:root` block's colour, spacing and shadow values.
2. Map the old variables onto the new tokens, so existing rules keep working:

   | Old variable | New value |
   | --- | --- |
   | `--color-bg` | `var(--surface-100)` |
   | `--color-surface` | `var(--surface-200)` |
   | `--color-text` | `var(--ink)` |
   | `--color-divider` | `var(--line)` |
   | `--color-accent`, `--color-accent-600` | `var(--brand-500)` (primary buttons) |
   | `--color-accent-100` | `var(--brand-100)` |
   | `--color-accent-700`, `--color-accent-800` | `var(--brand-ink)` |
   | `--color-accent-900` | `var(--ink)` |
   | `--radius-md` | `var(--radius-md)` from tokens (14px) |

3. Errors and warnings currently reuse the accent blue. Point them at the warning colours instead: `.error-text`, `.stock-hint.blocking`, `.discount-input.invalid`, `.discount-hint.invalid`, `.tag-warn`, `.kpi-delta.warn` use `var(--tomato-ink)`, with `var(--tomato-100)` where a background is needed.
4. Focus rings (`.billing-screen … :focus-visible`, `.modal-card … :focus-visible`, `.field input:focus-visible`): `3px solid var(--sky-600)`, offset 2px.
5. Base size: `body` 16px; inputs and buttons at least 44px tall, billing controls 56px (`--tap-min`).

## Phase 2: app shell (`App.tsx`, `styles.css`)

Wireframes: any `S` file. Rail 216px on `--surface-200`, logo mark and "Supermarket POS" at the top, a 20px line icon per nav item, Ctrl shortcut right-aligned, active item `--brand-100` / `--brand-ink`, notifications badge `--tomato-600`. Header: 24px bold title. Status banners: offline `--surface-300`, default-password `--sun-100`, alerts and crash `--sky-100`, each with an icon. Keep `.rail.collapsed`.

## Phase 3: billing (`features/billing/*`)

Wireframes: `S04Billing`, `S05BillingSearch`.

- `CartPanel.tsx` / `.cart-panel`: two columns with CSS grid. The table scrolls on the left; `.totals-box` becomes a 360px right column. In `.totals-box`, give `.row.net` `order: -1` and style it as the yellow total (`--sun-400` background, `--on-sun` text, 46–52px figure). Payment button at the bottom: `--brand-500`, 64–72px tall, F9 keycap. Tax rows, discount and wholesale go in a card between them. No JSX change is needed for the layout; a "You saved ₹…" line when `totals.discountPaise > 0` is a small optional addition.
- Cart rows: product name 17px semibold; qty and discount inputs 34–38px; remove button outlined in `--line` with `--tomato-ink` ✕; stock shortfall in `--tomato-ink` with "!".
- `SearchPanel.tsx`: input 56px, 18px text, `--sky-600` focus with a `--sky-100` glow; highlighted result `--sky-100` / `--sky-ink`; zero stock in `--tomato-ink`.
- Bill tabs: pill buttons; active one `--brand-100` with a `--brand-500` border. Bill actions bar: ghost buttons in `--sky-600`.
- `BillingScreen.tsx` sets the last-message banner colour inline. Replace that with a class: success `--brand-100` / `--brand-ink` with a ✓ icon.
- `CustomerBar.tsx`: customer chip `--sky-100`, amount owed chip `--sun-100`.

## Phase 4: popups (`modal-card`, `modal-backdrop`)

Wireframes: `P01`–`P19`. Cards: `--surface-200`, radius 20px, padding 24px, large shadow; titles 24px bold; buttons at least 52px, Cancel left and primary right. `PaymentModal.tsx`: inputs 52px with 20px figures; `.change-due` becomes the yellow box with a 34px figure, and the two change choices are buttons inside it. `ManagerApprovalDialog`: blue lock icon above the title. `KhataDrawer`: slides in from the right (`P18`).

## Phase 5: other screens

Wireframes: `S03`, `S06`–`S20`. Restyle `.blueprint` as a rounded card (`--surface-200`, radius 20px, `--shadow-card`) and hide the corner marks. Keep `BlueprintCard` so no screen code changes. `.kpi-card` uses 30px bold values; `.table` headers are 12px uppercase muted with 15px rows; status uses pills (`ok`, `warn`, `bad`, `info`, `mute`).

## Phase 6: per-user theme preference (new feature)

Wireframes: `P22Appearance`, `P23ThemeQuickSwitch`, and the Appearance card in `S18Settings`.

- **Preference shape:** `{ set: "calm" | "vivid", mode: "day" | "night" | "auto", highContrast: boolean }`. The resolved theme is `contrast` if `highContrast`; otherwise calm gives `light`/`dark` and vivid gives `vivid`/`vivid-night`. `auto` means night from 19:00 to 07:00, or `matchMedia("(prefers-color-scheme: dark)")`.
- **Storage:** per user, not per device. Unlike the screen language (`UI_LANGUAGE_KEY` in `main/ipc/uiSettings.ts`, one value per device), use a key per user, such as `ui.theme.<userId>`, through `settingsRepo`, audited the same way.
- **Plumbing:** follow the language feature end to end:
  - `uiGetTheme` / `uiSetTheme` channels in `shared/ipc.ts`
  - handlers in `main/ipc/uiSettings.ts`
  - a Zod schema in `packages/validation`
  - `window.api.ui.getTheme` / `setTheme` in `preload/index.ts`
  - a zustand store like `useUiLanguageStore` that sets `document.documentElement.dataset.theme`
- **UI:**
  - An Appearance card in `SettingsScreen.tsx` next to `LanguageCard`, with an "Appearance" window showing four live preview tiles (each tile is a `div` with its own `data-theme`), Day / Night / Auto and a High contrast switch.
  - A sun/moon button beside the `EN | த` toggle in the rail footer, opening the quick switch.
- **Before sign-in**, the login and activation screens use `light`.

## Phase 7: optional improvements found while reviewing

- Replace the nine `window.confirm` calls, six different messages (in `InventoryScreen`, `ExpiryCard`, `ProductEditModal`, `AddProductModal`, `PurchasesScreen`, `ReceiveGoodsModal`, `EmployeesScreen`) with a themed confirm dialog (`P21ConfirmPrompts`): question names the item, safe choice on the left, risky one in `--tomato-600`.
- `SettingsScreen.handleRestore` restores a backup with no confirmation. Add the confirm in `P20RestoreBackup`.

## Wireframe ↔ code map

| Wireframe | Code |
| --- | --- |
| S01 Activation | `features/auth/ActivationScreen.tsx`, `ActivationForm.tsx` |
| S02 Login | `features/auth/LoginScreen.tsx` |
| S03 Dashboard + banners | `features/dashboard/DashboardScreen.tsx`, `CashRegisterCard.tsx`, `App.tsx` banners, `features/alerts/AlertsBanner.tsx` |
| S04–S05 Billing | `features/billing/BillingScreen.tsx`, `CartPanel.tsx`, `SearchPanel.tsx`, `BillActionsBar.tsx`, `CustomerBar.tsx` |
| S06 Inventory | `features/inventory/InventoryScreen.tsx`, `ExpiryCard.tsx` |
| S07 Sales | `features/sales/SalesScreen.tsx` |
| S08 Customers | `features/customers/CustomersScreen.tsx` |
| S09–S11 Purchases | `features/purchases/PurchasesScreen.tsx`, `PurchaseOrdersPanel.tsx`, `PurchaseOrderEditor.tsx` |
| S12 Suppliers | `features/suppliers/SuppliersScreen.tsx` |
| S13 Returns | `features/returns/ReturnsScreen.tsx`, `ReturnLinePicker.tsx` |
| S14–S15 Reports | `features/reports/ReportsScreen.tsx`, `InsightsReports.tsx` |
| S16 Employees | `features/employees/EmployeesScreen.tsx` |
| S17 Notifications | `features/alerts/AlertsScreen.tsx` |
| S18 Settings | `features/settings/*` |
| S19 Coming soon | `components/ComingSoonScreen.tsx` |
| S20 Error + banners | `ErrorBoundary.tsx`, `App.tsx` |
| P01 Quantity | `billing/QuantityModal.tsx` |
| P02 Payment | `billing/PaymentModal.tsx` |
| P03 Manager approval | `components/ManagerApprovalDialog.tsx` |
| P04 Return on bill | `billing/ReturnAgainstBillModal.tsx` |
| P05 Settle exchange | `billing/ExchangeSettleModal.tsx` |
| P06 Recovery | `billing/RecoveryModal.tsx` |
| P07 Shortcuts | `billing/ShortcutHelpOverlay.tsx` |
| P08–P10 Merge / Split / Customer for | `billing/MergeBillModal.tsx`, `SplitBillModal.tsx`, `AssignCustomerModal.tsx` |
| P11 Add customer | `components/CustomerFormModal.tsx` |
| P12–P16 Inventory popups | `inventory/AddProductModal.tsx`, `ProductEditModal.tsx`, `PackSizesSection.tsx`, `StockAdjustModal.tsx`, `LabelPrintModal.tsx`, `RepackModal.tsx` |
| P17 Receive goods | `purchases/ReceiveGoodsModal.tsx` |
| P18 Khata drawer | `customers/KhataDrawer.tsx` |
| P19 Edit employee | `employees/EditEmployeeModal.tsx` |
| P20–P21 Confirms | new (Phase 7) |
| P22–P23 Appearance | new (Phase 6) |
