# Budget Amendment Request

A plain HTML, CSS, and JavaScript recreation of the county Budget Amendment
Request paper form. No frameworks, no build tools, no dependencies — just
open `index.html` in a browser. Department and Account fields are searchable
dropdowns driven live by a Google Sheets Chart of Accounts, and submitting a
request generates a PDF, records it across two more worksheets in that same
spreadsheet, and emails the PDF to Budget Office staff and the requestor —
all handled by the same Google Apps Script backend. The PDF is never
saved anywhere; it's built fresh per submission just to attach to those
two emails.

## Getting Started

1. **Connect your Chart of Accounts** — see
   [`docs/google-sheets-integration.md`](docs/google-sheets-integration.md)
   for the one-time setup (deploy a small Google Apps Script, paste its URL
   into `js/googleSheets.js`). Until this is done, the site shows a clear
   "not configured yet" banner instead of empty dropdowns.
2. Double-click `index.html`, or open it from your browser with
   **File → Open**. That's it — nothing to install, no server required.

## Features

- Date picker, Description, Prepared By, and Title fields
- Amendment type selection (Fl. St. 129.06(2)(a)–(f)), matching the original form
- **Searchable department dropdown(s)** — one for Intradepartmental Amendment
  (governs both Transfer From and Transfer To); two independent ones (Transfer
  From Department / Transfer To Department) for every other amendment type
- **Searchable account dropdowns** for Transfer From / Transfer To, combining
  Expense object codes and Revenue codes (grouped and clearly labeled),
  scoped to whichever department governs that row — search by code or name
- Choosing (or clearing) a department clears and re-filters that side's
  account selections automatically
- Add/remove rows, with live, auto-formatted totals
- Required-field and account-validity validation with inline error messages,
  including a Requestor Email Address field (format-validated) and a check
  that Transfer From and Transfer To totals match before submitting
- **Submit Budget Transfer Request** — validates the form, then generates a
  PDF, records the request (and each transfer line) in the spreadsheet, and
  emails the PDF to Budget Office staff and the requestor. Shows a unique
  Request ID on success
- **Save Draft** — stores the current form state (including department/account
  selections) in the browser's Local Storage
- **Automatic draft restore** — if a saved draft exists, you're prompted to
  restore or discard it the next time the page loads
- **Print Form** — a print-friendly layout with buttons and banners hidden
- **Clear Form** — resets all fields (with a confirmation prompt)
- **Refresh Chart of Accounts** — reloads department/account data without a
  full page reload, for after you edit the spreadsheet
- Responsive layout for desktop, tablet, and mobile
- Accessible combobox controls: full keyboard navigation (arrows, Home/End,
  Enter, Escape), `aria-invalid` states, and screen-reader-friendly labeling

## Project Structure

```
Budget-Transfer-Request/
│
├── index.html
├── css/
│   └── styles.css              All styling (responsive + print + comboboxes)
├── js/
│   ├── app.js                  DOM wiring, comboboxes, table rows, event handlers, init
│   ├── googleSheets.js         Fetches/caches the Chart of Accounts (the only module aware of Google Sheets)
│   ├── departments.js          Department repository (search/lookup)
│   ├── expenses.js             Expense account repository, scoped by department
│   ├── revenue.js              Revenue account repository, scoped by department
│   ├── accountSearch.js        Generic accessible combobox widget (used for departments + accounts)
│   ├── amendmentRules.js       Maps amendment type → single/dual department mode
│   ├── validation.js           Field/form/department/account validation
│   ├── calculations.js         Currency parsing/formatting, totals
│   ├── storage.js              Draft save/load/clear (Local Storage)
│   ├── print.js                Print handling
│   └── submission.js           Posts a completed request to the Apps Script backend
├── docs/
│   ├── google-sheets-integration.md  Chart of Accounts setup guide
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
in Chrome). Each module attaches itself to `window.BudgetApp.<Name>`, and
`index.html` loads them in dependency order:

```
calculations → storage → googleSheets → departments → expenses → revenue
→ accountSearch → validation → amendmentRules → print → submission → app
```

`googleSheets.js` is the **only** module that knows the Chart of Accounts
lives in a Google Sheet — `departments.js`/`expenses.js`/`revenue.js` and
everything above them only ever call `load()`/`search()`/`getByDepartment()`.
Pointing those three repositories at a real database later means changing
only `googleSheets.js`, with no UI changes required. `submission.js` reuses
`googleSheets.js`'s `getApiUrl()` rather than duplicating the Apps Script
URL — the read (`doGet`) and submit (`doPost`) endpoints are the same
deployment.

## Design

Visual style (colors, typography, header lockup, seal treatment) matches
[budget-waltoncountyfl.com](https://budget-waltoncountyfl.com/) — Walton
County's green (`#006231`)/gold (`#d1be78`) brand, Arial/Helvetica body
text, and a Georgia serif accent reserved for the page title, same as the
reference site's own usage. The county seal (used with permission) lives at
`assets/images/walton-county-seal.png` and appears in both the on-screen
header and the print view.

## Notes

- **Submit** and **Print** are independent: Print is an instant, client-side
  `window.print()` of the current on-screen form — nothing is sent
  anywhere. Submit is the one action that actually sends the request
  anywhere: it POSTs to the Apps Script backend, which generates a *separate*
  PDF from the submitted data, records the request, and emails that PDF out
  (the PDF itself is never saved anywhere — it exists only long enough to
  attach to the two emails). See [`docs/google-sheets-integration.md`](docs/google-sheets-integration.md#6-set-up-request-submission-sheets-storage--email)
  for the one-time setup (three more worksheets and a Settings sheet for
  notification emails) required before Submit will work.
- Draft data is stored only in your browser's Local Storage on this device;
  it is not shared or synced anywhere. Drafts saved by the original
  free-text-field version of this site are not compatible and are silently
  ignored; a draft saved before the Requestor Email field existed restores
  fine, just with that one field blank. A successful submission clears the
  saved draft.
- Chart of Accounts data is cached for the current browser tab only
  (`sessionStorage`); use the **Refresh Chart of Accounts** link after
  editing the spreadsheet, or simply reopen the page.
