# Budget Amendment Request

A plain HTML, CSS, and JavaScript recreation of the county Budget Amendment
Request paper form. No frameworks, no build tools, no dependencies — just
open `index.html` in a browser.

## Getting Started

Double-click `index.html`, or open it from your browser with **File → Open**.
That's it — there is nothing to install and no server required.

## Features

- Date picker, Department, Prepared By, and Title fields
- Amendment type selection (Fl. St. 129.06(2)(a)–(f)), matching the original form
- Transfer From / Transfer To account tables with add/remove rows and live,
  auto-formatted totals
- Required-field validation with inline error messages
- **Submit** — validates the form and shows a confirmation banner
- **Save Draft** — stores the current form state in the browser's Local Storage
- **Automatic draft restore** — if a saved draft exists, you're prompted to
  restore or discard it the next time the page loads
- **Print Form** — a print-friendly layout with buttons and banners hidden
- **Clear Form** — resets all fields (with a confirmation prompt)
- Responsive layout for desktop, tablet, and mobile
- Accessible labels, `aria-invalid` states, and keyboard-friendly controls

## Project Structure

```
Budget-Transfer-Request/
│
├── index.html
├── css/
│   └── styles.css              All styling (responsive + print)
├── js/
│   ├── app.js                  DOM wiring, table rows, event handlers, init
│   ├── validation.js           Field/form validation
│   ├── calculations.js         Currency parsing/formatting, totals
│   ├── storage.js               Draft save/load/clear (Local Storage)
│   └── print.js                Print handling
├── assets/
│   ├── images/
│   │   └── logo-placeholder.png  Generic header logo placeholder
│   └── icons/                  Reserved for future standalone icon assets
├── forms/                      Reserved for future additional form variants
├── docs/                       Reserved for future project documentation
└── README.md                   This file
```

### Module dependencies

There's no bundler, so the scripts are plain `<script>` tags that share a
single `window.BudgetApp` namespace instead of ES module imports (ES
modules are blocked by CORS when a page is opened directly via `file://`
in Chrome). Each module attaches itself to `window.BudgetApp.<Name>`, and
`index.html` loads them in dependency order:

```
calculations.js → storage.js → validation.js → print.js → app.js
```

`app.js` is the only one that touches the DOM's event wiring/initialization;
the other four are self-contained and could be reused or unit tested on
their own.

## Notes

- The header logo is a generic placeholder icon, not an official county seal.
  Swap `assets/images/logo-placeholder.png` for a real logo whenever you're ready.
- There is no backend — "Submit" validates the form and displays a
  confirmation message, but does not send data anywhere. Use **Print** to
  produce a physical/PDF copy for routing and signatures.
- Draft data is stored only in your browser's Local Storage on this device;
  it is not shared or synced anywhere.
