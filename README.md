# Operations Management Portal

A plain HTML, CSS, and JavaScript portal for county operations. No
frameworks, no build tools, no dependencies — just open `index.html` in a
browser. Its Budget Management module currently offers three workflows:

- **Budget Request** (`budget-request.html`) — request funding for the
  next fiscal year.
- **Transfer Request** (`transfer.html`) — transfer existing budget
  between accounts or amend the current fiscal year budget.
- **Fiscal Year Rollforward Request** (`rollforward.html`) — request
  authorization to roll unspent budget into the next fiscal year.

All three share the same Department/Account dropdowns, driven live by a
Google Sheets Chart of Accounts, and the same Google Apps Script backend: each
submission generates a PDF, records the request in its own worksheet(s),
and emails the PDF to Budget Office staff. The PDF is never saved anywhere;
it's built fresh per submission just to attach to that email. A pop-up
confirms each submission to the requester on-screen.

## Getting Started

1. **Connect your Chart of Accounts** — see
   [`docs/google-sheets-integration.md`](docs/google-sheets-integration.md)
   for the one-time setup (deploy a small Google Apps Script, paste its URL
   into `js/googleSheets.js`). Until this is done, both request pages show
   a clear "not configured yet" banner instead of empty dropdowns.
2. Double-click `index.html`, or open it from your browser with
   **File → Open**. That's the portal home page — pick a request type from
   there. Nothing to install, no server required.
3. **Work Orders only** — this module needs its own small backend (it
   reads back and updates records over time, unlike the one-way Budget/
   Grant/Rollforward submissions). From the `server/` folder:
   ```
   cd server
   npm install
   npm start
   ```
   This starts the Work Orders API at `http://localhost:4000`. Leave it
   running, then open `work-order-request.html` or `work-order-list.html`
   as usual. Data is stored in `server/operations-portal.db` (SQLite,
   git-ignored) — delete that file to reset.

   Locations, Categories, and Assignees are managed from
   `work-order-admin.html` (linked from the Work Orders module page and
   from the request/list pages). The database ships pre-seeded with 220
   locations, 41 activity categories, and 9 assignees pulled from the old
   CMMS's export, plus its 912 historical work orders — see
   `server/scripts/convert-legacy-export.py` and
   `server/scripts/import-legacy-work-orders.js` if that data ever needs
   to be re-imported into a fresh database.

## Features

**Portal-wide**
- Shared navigation (one link per module — Budget, Grant, Project,
  Asset Tracking, Work Orders, Reports & Analytics) on every page, with
  the current module highlighted; the header logo/seal links home
- Accessible, searchable department/account combobox controls: full
  keyboard navigation (arrows, Home/End, Enter, Escape), `aria-invalid`
  states, and screen-reader-friendly labeling
- Responsive layout for desktop, tablet, and mobile
- A pop-up confirms each successful submission, naming its Request ID

**Budget Request**
- Requester Name / Email (50-character limit) and a single department
  govern the whole request; **+ Add Another Requested Account** adds as
  many "requested account" line items as needed, each with its own
  searchable Expense Account (same combobox as Transfer/Rollforward,
  project-code search/autofill included), an optional Project Number and
  Current FY Budget (for reference), a Requested Amount for next fiscal
  year ($0.01–$99,999,999.99), and its own Justification (250-character
  limit)
- A "Requesting Funding For Fiscal Year" dropdown and a required
  certification checkbox apply to the whole request
- **Print Form** and Request IDs (`BR-2026-0001`) numbered separately
  from every other workflow's own numbering

**Transfer Request**
- Date picker, Description (required, 250-character limit), Prepared By and
  Title fields (50-character limit each)
- **Intradepartmental Amendment** (Fl. St. 129.06(2)(a)) is currently the
  only request type — pre-selected and not a required field, since there's
  nothing else to choose. The dual-department machinery for other amendment
  types (Interdepartmental, Reserve, etc.) still exists under the hood and
  can be re-enabled later without code changes
- **Searchable department dropdown** governing both Transfer From and
  Transfer To (50-character search limit)
- **Searchable account dropdowns** for Transfer From / Transfer To, combining
  Expense object codes and Revenue codes (grouped and clearly labeled),
  scoped to whichever department governs that row — search by code or name
- Add/remove rows, with live, auto-formatted totals, and a check that
  Transfer From and Transfer To totals match before submitting; each amount
  must be between $0.01 and $99,999,999.99
- **Save Draft** / **Automatic draft restore** — stores the current form
  state in the browser's Local Storage and offers to restore it later
- **Print Form** — a print-friendly layout with buttons and banners hidden
- **Refresh Chart of Accounts** — reloads department/account data without a
  full page reload, for after you edit the spreadsheet

**Fiscal Year Rollforward Request**
- Requester Name / Email (50-character limit) and a single department
  govern the whole request; **+ Add Another Rollforward Request** adds as
  many "accounts to roll forward" line items as needed, each with its own
  searchable Expense Account (same combobox as Transfer, project-code
  search/autofill included), an optional Project Number and Contract or PO
  Number, an Amount ($0.01–$99,999,999.99), and its own Detailed
  Justification (250-character limit)
- A Fiscal Year dropdown (easy to extend with future years) and a required
  certification checkbox apply to the whole request
- Request IDs are numbered separately from Transfer Request's (`RF-2026-0001`)
  and never interfere with Transfer Request's own numbering

## Project Structure

```
Budget-Transfer-Request/
│
├── index.html                  Landing page — choose a module
├── budget-request.html          Budget Request form (funding for next fiscal year)
├── transfer.html                Transfer Request form
├── rollforward.html             Fiscal Year Rollforward Request form
├── css/
│   └── styles.css              All styling (responsive + print + comboboxes + nav)
├── js/
│   ├── app.js                  transfer.html's page controller (DOM wiring, comboboxes, table rows, submit)
│   ├── rollforward.js          rollforward.html's page controller (same pattern as app.js, simpler form)
│   ├── nav.js                  Renders the shared Home/Transfer/Rollforward nav bar on every page
│   ├── googleSheets.js         Fetches/caches the Chart of Accounts (the only module aware of Google Sheets)
│   ├── departments.js          Department repository (search/lookup) — shared by both pages
│   ├── expenses.js             Expense account repository, scoped by department — shared by both pages
│   ├── revenue.js              Revenue account repository, scoped by department — Transfer only
│   ├── accountSearch.js        Generic accessible combobox widget — shared by both pages
│   ├── amendmentRules.js       Maps amendment type → single/dual department mode — Transfer only
│   ├── validation.js           Field/form/department/account/checkbox validation — shared by both pages
│   ├── calculations.js         Currency parsing/formatting, totals — shared by both pages
│   ├── storage.js              Draft save/load/clear (Local Storage) — Transfer only
│   ├── print.js                Print handling — Transfer only
│   └── submission.js           Posts a completed request to the Apps Script backend — shared by both pages
├── docs/
│   ├── google-sheets-integration.md  Chart of Accounts + both request-type setup guide
│   └── apps-script/
│       └── Code.gs             Apps Script source to paste into your spreadsheet's script editor
├── assets/
│   ├── images/
│   │   └── walton-county-seal.png  Official county seal (header + print)
│   └── icons/                  Reserved for future standalone icon assets
├── forms/                      Reserved for future additional form variants
└── README.md                   This file
```

### Module dependencies

There's no bundler, so the scripts are plain `<script>` tags that share a
single `window.BudgetApp` namespace instead of ES module imports (ES
modules are blocked by CORS when a page is opened directly via `file://`
in Chrome). Each module attaches itself to `window.BudgetApp.<Name>`.

`googleSheets.js` is the **only** module that knows the Chart of Accounts
lives in a Google Sheet — `departments.js`/`expenses.js`/`revenue.js` and
everything above them only ever call `load()`/`search()`/`getByDepartment()`.
Pointing those repositories at a real database later means changing only
`googleSheets.js`, with no UI changes required. `submission.js` reuses
`googleSheets.js`'s `getApiUrl()` rather than duplicating the Apps Script
URL — the read (`doGet`) and submit (`doPost`) endpoints are the same
deployment, shared by both `transfer.html` and `rollforward.html`; `doPost`
tells the two request types apart by a `requestType` field the client
sends automatically.

`transfer.html` loads:
```
calculations → storage → googleSheets → departments → expenses → revenue
→ accountSearch → validation → amendmentRules → print → submission → nav → app
```

`rollforward.html` loads the smaller set it actually needs — no `revenue`
(rollforward is expense-only), no `amendmentRules`/`storage`/`print`
(single department, no drafts, no print view):
```
calculations → googleSheets → departments → expenses
→ accountSearch → validation → submission → nav → rollforward
```

## Design

Visual style (colors, typography, header lockup, seal treatment) matches
[budget-waltoncountyfl.com](https://budget-waltoncountyfl.com/) — Walton
County's green (`#006231`)/gold (`#d1be78`) brand, Arial/Helvetica body
text, and a Georgia serif accent reserved for page titles, same as the
reference site's own usage. The county seal (used with permission) lives at
`assets/images/walton-county-seal.png` and appears in every page's header
and every request form's print view.

## Notes

- **Submit** and **Print** are independent: Print is an instant,
  client-side `window.print()` of the current on-screen form — nothing is
  sent anywhere. Submit is the one action that actually sends a request
  anywhere: it POSTs to the Apps Script backend, which generates a
  *separate* PDF from the submitted data, records the request, and emails
  that PDF to Budget Office staff (the PDF itself is never saved anywhere
  — it exists only long enough to attach to that email). A pop-up
  confirms the submission on-screen; no confirmation email is sent to
  the requester/requestor on any workflow. See
  [`docs/google-sheets-integration.md`](docs/google-sheets-integration.md)
  for the one-time setup (extra worksheets and a Settings sheet for
  notification emails) required before any Submit button will work.
- Draft data (Transfer Request only) is stored in your browser's Local
  Storage on this device; it is not shared or synced anywhere. A
  successful submission clears the saved draft.
- Chart of Accounts data is cached for the current browser tab only
  (`sessionStorage`), shared across both pages if you visit them in the
  same tab; use the **Refresh Chart of Accounts** link after editing the
  spreadsheet, or simply reopen the page.
