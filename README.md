# Budget Management Portal

A plain HTML, CSS, and JavaScript portal for county budget requests. No
frameworks, no build tools, no dependencies — just open `index.html` in a
browser. It currently offers two workflows:

- **Budget Transfer / Amendment Request** (`transfer.html`) — transfer
  existing budget between accounts or amend the current fiscal year budget.
- **Fiscal Year Rollforward Request** (`rollforward.html`) — request
  authorization to roll unspent budget into the next fiscal year.

Both share the same Department/Account dropdowns, driven live by a Google
Sheets Chart of Accounts, and the same Google Apps Script backend: each
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

## Features

**Portal-wide**
- Shared navigation (Home / Budget Transfer / Rollforward Request) on
  every page, with the current page highlighted
- Accessible, searchable department/account combobox controls: full
  keyboard navigation (arrows, Home/End, Enter, Escape), `aria-invalid`
  states, and screen-reader-friendly labeling
- Responsive layout for desktop, tablet, and mobile
- A pop-up confirms each successful submission, naming its Request ID

**Budget Transfer / Amendment Request**
- Date picker, Description (required), Prepared By, and Title fields
- Amendment type selection (Fl. St. 129.06(2)(a)–(f)), matching the original form
- **Searchable department dropdown(s)** — one for Intradepartmental Amendment
  (governs both Transfer From and Transfer To); two independent ones (Transfer
  From Department / Transfer To Department) for every other amendment type
- **Searchable account dropdowns** for Transfer From / Transfer To, combining
  Expense object codes and Revenue codes (grouped and clearly labeled),
  scoped to whichever department governs that row — search by code or name
- Add/remove rows, with live, auto-formatted totals, and a check that
  Transfer From and Transfer To totals match before submitting
- **Save Draft** / **Automatic draft restore** — stores the current form
  state in the browser's Local Storage and offers to restore it later
- **Print Form** — a print-friendly layout with buttons and banners hidden
- **Refresh Chart of Accounts** — reloads department/account data without a
  full page reload, for after you edit the spreadsheet

**Fiscal Year Rollforward Request**
- Requester Name / Email, a single department + expense account pair (same
  searchable comboboxes as Transfer, project-code search/autofill included),
  Amount, a Fiscal Year dropdown (easy to extend with future years), a
  Detailed Justification textarea, and a required certification checkbox
- Request IDs are numbered separately from Budget Transfer's (`RF-2026-0001`)
  and never interfere with Budget Transfer's own numbering

## Project Structure

```
Budget-Transfer-Request/
│
├── index.html                  Landing page — choose a request type
├── transfer.html                Budget Transfer / Amendment Request form
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
and Budget Transfer's print view.

## Notes

- **Submit** and **Print** are independent (Print only exists on the
  Budget Transfer page): Print is an instant, client-side `window.print()`
  of the current on-screen form — nothing is sent anywhere. Submit is the
  one action that actually sends a request anywhere: it POSTs to the Apps
  Script backend, which generates a *separate* PDF from the submitted
  data, records the request, and emails that PDF to Budget Office staff
  (the PDF itself is never saved anywhere — it exists only long enough to
  attach to that email). A pop-up confirms the submission on-screen; no
  confirmation email is sent to the requester/requestor on either
  workflow. See
  [`docs/google-sheets-integration.md`](docs/google-sheets-integration.md)
  for the one-time setup (extra worksheets and a Settings sheet for
  notification emails) required before either Submit button will work.
- Draft data (Budget Transfer only) is stored in your browser's Local
  Storage on this device; it is not shared or synced anywhere. A
  successful submission clears the saved draft.
- Chart of Accounts data is cached for the current browser tab only
  (`sessionStorage`), shared across both pages if you visit them in the
  same tab; use the **Refresh Chart of Accounts** link after editing the
  spreadsheet, or simply reopen the page.
