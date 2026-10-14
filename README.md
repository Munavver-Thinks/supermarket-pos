# Supermarket POS — Phase 1 MVP

A single-counter, offline-first retail billing app for Indian supermarkets: barcode +
Tanglish/fuzzy product search, multiple concurrent bills, GST-aware billing, cash/UPI/card
payments, inventory tracking, and crash recovery. Built with Electron + React + TypeScript,
SQLite locally via Kysely, business logic split into a framework-agnostic, unit-tested
package. See `plan.md`-equivalent context in the original planning docs for the full
multi-phase roadmap (purchases, wholesale/GST, AI, multi-store, mobile) — this repo covers
**Phase 1** only.

## Repo layout

```
apps/pos-desktop      Electron app: electron/ (main process, preload, shared IPC contract) and src/ (React renderer)
packages/types        Shared TypeScript DTOs
packages/database      Kysely schema, migrations, repositories (SQLite)
packages/validation    Zod schemas for every IPC input
packages/business-logic Pure, unit-tested engines: tax, discount, search, quantity parsing,
                         billing totals, money formatting — no Electron/DB imports
```

## Prerequisites

- Node.js 22 LTS (Node 24 currently lacks a `better-sqlite3` prebuilt binary on Windows —
  stick to Node 22 until that catches up)
- pnpm (`corepack enable && corepack prepare pnpm@9.12.0 --activate`)
- Windows 10/11 (Phase 1 hardware/printer integration targets Windows first)

No C++ build toolchain (Python/Visual Studio Build Tools) is required — `better-sqlite3`
ships prebuilt binaries that `pnpm install` fetches automatically.

## Setup

```powershell
pnpm install
```

## A native-module quirk you will hit: Node vs. Electron ABI

`better-sqlite3` is a native addon. It's used both by `@pos/database`'s own test suite
(running under plain Node/Vitest) and by the Electron app (running under Electron's bundled
Node, a different ABI). pnpm shares one physical copy of the compiled binary across both
consumers, so switching between "run tests" and "run the app" requires re-targeting the
build once:

```powershell
pnpm rebuild:node       # before running tests
pnpm test

pnpm rebuild:electron   # before running/packaging the app
pnpm dev
```

`pnpm test`, `pnpm dev`, `pnpm build`, and `pnpm package` already call the right rebuild
step for you — you only need to run these manually if you're mixing ad-hoc commands.

## Running the app

```powershell
pnpm dev
```

This starts Vite (renderer + main/preload watch builds) and launches Electron. On first run
it seeds a default organization/store/device and an **owner** login:

```
username: admin
password: admin123
```

**Change this immediately** — there's no user-management screen yet (flagged as a fast
follow); for now update the `users` table directly with a proper bcrypt hash if needed.

> **Note on sandboxed/headless environments:** if `ELECTRON_RUN_AS_NODE=1` is set (common in
> CI or headless agent sandboxes), Electron runs as plain Node and `require('electron')`
> returns a path string instead of the API — the app cannot open a real window there. Run
> `pnpm dev` on an actual desktop session (unset that env var) to see the UI.

### Golden path to try

1. Log in as `admin` / `admin123`.
2. Go to **Inventory → Add Product**, create a product (e.g. "Aachi Chilli Powder 200g",
   alias "aachi milagai", tax rate 5%, MRP/sale/cost prices).
3. Go to **Inventory → Adjust Stock**, paste the new product's ID (shown in the low-stock
   list) and set an opening quantity via reason "Stock in".
4. Go to **Billing**, type the alias ("aachi milagai") or "2 aachi milagai", press Enter to
   add it to the cart, open **Payment**, enter a cash amount matching the total, confirm.
5. The sale completes, stock decrements, a receipt print is attempted (falls back
   gracefully with a message if no printer is configured), and the bill resets.
6. Try **+ New Bill** to hold a second bill while the first stays open; try force-quitting
   the app mid-bill (with unsaved cart lines) and relaunching — a recovery prompt should
   offer to restore it, since the active cart autosaves after every change.

## Testing

```powershell
pnpm test        # Vitest: business-logic unit tests + database integration tests
pnpm typecheck   # tsc --noEmit across every package
pnpm lint        # ESLint, zero warnings allowed
```

The integration tests exercise the real transactional path against a temp SQLite DB:
sale creation decrements stock and appends an audit-trail ledger entry in one transaction,
retrying the same `clientTxnId` is idempotent (no double sale, no double stock decrement),
and bill numbers are atomic and gap-free per counter.

## Building an installer

```powershell
pnpm package
```

Produces a Windows NSIS installer under `apps/pos-desktop/release/`. Unsigned by default —
code-signing is a business decision (needs a cert) to revisit before wide distribution.
`electron-updater` is wired in as a dependency but not yet pointed at a real release feed;
wiring that up is a fast follow once you have somewhere to publish releases (GitHub Releases
or S3).

## Device activation

A device can require an activation key before it's usable — see `activation.ts`. It's a
deterrent, not real protection: it binds to a device id computed locally, checked entirely
offline against a public key baked into the app (`activationPublicKey.ts`). There is no
online validation, no revocation, and no trial mode. Copying the data folder copies the
activation with it; editing `device-config.json` or patching the app bypasses it outright.

**The keypair checked into this repo is a pre-release placeholder — its private key was not
kept anywhere.** No real activation key can ever be issued against it. Before relying on this
gate, generate a real pair (`node apps/pos-desktop/scripts/activation-keys.mjs keygen`), put
the new public key in `activationPublicKey.ts`, and keep the private key out of the repo
entirely — it's what you (or whoever issues keys to shops) sign requests with. Until then,
`activationRequired` is never set on a fresh install, so the gate stays off and every install
opens straight to login, same as before this existed.

An existing install is never retroactively gated ("grandfathered") — it shows "Not activated"
in Settings and can activate whenever you're ready, without being forced.

## Screen language (Tamil)

Settings → Screen language, and the "EN | த" toggle in the nav rail, switch the nav labels,
screen titles, sign-out, the offline/default-password banners, the login screen (shown
bilingually, with no toggle before sign-in), and the activation/manager-approval dialogs
between English and Tamil. See `packages/business-logic/src/uiStrings.ts` for the exact
string table.

Everything else — every screen body (Dashboard, Billing, Inventory, Purchases, Suppliers,
Customers, Returns, Sales, Reports, Employees, Settings, Alerts), error messages from the
main process, audit-log descriptions, and number/date formats — stays in English. **The Tamil
wording is a first draft and has not been reviewed by a native speaker**; treat it the same
way as the activation keypair above — real, working, but unverified before you put it in
front of a real shop.

## What's deliberately out of scope for Phase 1

- **AI** (OCR/voice/vision), and any online sync (multi-store, multi-counter LAN sharing) —
  none of this exists.
- **Wholesale/GST invoicing specifics**: tax-exclusive pricing, IGST, e-Way bill.
- **Manager approval**: only a local in-memory throttle against repeated wrong passwords
  (resets on app restart); no remote or mobile approval; no approval for voids (voids aren't
  built).
- **Batches**: returns and upward stock adjustments come back as untracked stock, not into a
  batch; downward adjustments trim batches automatically (expired first) rather than letting
  the user pick one; stock already on hand when a shop upgrades to this version has no batch
  history; the cashier can't choose a batch at billing (earliest-expiry-first only); no
  per-batch MRP or per-batch cost of goods; the expiry-alert window is a fixed 30 days.
- **Purchase orders**: no printing or emailing a PO; no editing one after it's placed (cancel
  and re-create instead); no reversing a goods receipt; no over-receipt.
- **Profit and slow-moving/dead-stock reports** use the recorded product cost and fixed
  default thresholds — an estimate, not an accounting close.
- **Crash reports** stay local; nothing is uploaded anywhere.

## Coding standards (enforced, not just documented)

- TypeScript `strict` + `noUncheckedIndexedAccess`; no `any` (ESLint-enforced)
- Money is always an integer number of paise — see `packages/business-logic/src/money.ts`
- `stock_ledger` and `audit_logs` are append-only at the repository layer
- Every financial write is one DB transaction; sale creation is idempotent via a
  client-generated `clientTxnId`
- Every IPC handler validates input with Zod before touching the database
- Husky + lint-staged run ESLint/Prettier on every commit (once this repo is a git repo —
  run `git init` first if you haven't; `pnpm install`'s `prepare` script no-ops otherwise)
#   s u p e r - m a r k e t - b i l l i n g - a p p  
 