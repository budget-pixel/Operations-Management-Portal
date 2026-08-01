# Chart of Accounts — Google Sheets Integration

The Operations Management Portal has four workflows — Transfer Request
(`transfer.html`), Grant Amendment Request (`grant.html`), Rollforward
Request (`rollforward.html`), and Budget Request (`budget-request.html`)
— and all four share this same setup. Their Department and Account
dropdowns are driven live by a Google Sheets workbook, read through a
single small Google Apps Script "Web App" that you deploy yourself. This
keeps your spreadsheet completely private — no API key is ever embedded
in the website's code, and nothing needs to be shared publicly. The same
Apps Script also *receives* submitted requests from all four workflows
(§6, §7, §8, and §9 below): it generates a PDF, records the request in
its own sheet(s), and emails the PDF to Budget Office staff. PDFs are
never saved anywhere (no Google Drive) — each exists only long enough to
attach to that email.

Grant Amendment Request is different from the other three: it never
searches the Chart of Accounts for an Expense or Revenue account. Instead
it computes both accounts directly from four choices (Federal or State
grant source, an activity code from the Florida Accounting Manual, the
selected Department, and an amendment category) plus the entered amount
— see §8 for the exact formula and the required "Grant Amendment
Requests" sheet.

## 1. Prepare the spreadsheet

Your workbook needs exactly three tabs, with these exact header rows (column
order doesn't matter, but the header **text** must match exactly):

**COA Departments**

| Department Code | Department Name |
|---|---|
| 101 | Administration |
| 205 | Public Works |
| 310 | Parks & Recreation |

**COA Expenses** — if a row already belongs to a specific project, put its
number in `Project`; leave it blank otherwise. That number becomes
searchable in the account box, and auto-fills the row's Project field once
that account is selected.

| Department Code | Expense Object | Expense Object Name | Project |
|---|---|---|---|
| 205 | 531100 | Office Supplies | |
| 205 | 552000 | Travel | |
| 310 | 564100 | Computer Equipment | 42150 |

**COA Revenue** — note the different column names on this tab: `Org Code` is
treated as the department code, `Object Code` as the revenue code, and
`Name` as the revenue name. A `Project` column here (if present) is ignored.

| Org Code | Object Code | Name |
|---|---|---|
| 205 | 341100 | Permit Fees |
| 310 | 361200 | Park Fees |

Neither COA Expenses nor COA Revenue needs a department *name* column —
only the code, which is what accounts are filtered by.

## 2. Add the Apps Script

1. Open your spreadsheet.
2. **Extensions → Apps Script**. This opens a script bound to your sheet.
3. Delete any starter code in `Code.gs`, then paste in the full contents of
   [`apps-script/Code.gs`](apps-script/Code.gs) from this repo.
4. Click **Save** (the disk icon), and give the project a name if prompted
   (e.g. "Budget COA API").

## 3. Deploy it as a Web App

1. Click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Configure:
   - **Execute as:** Me (your account)
   - **Who has access:** Anyone
   
   "Anyone" here does **not** make your spreadsheet public — it only allows
   the script (which runs with *your* permissions) to be called. Your sheet
   itself is never shared.
4. Click **Deploy**, then **Authorize access** and approve the permissions
   prompt (you'll see an "unverified app" warning — this is expected for a
   script only you use; click **Advanced → Go to (project name)** to proceed).
   Submitting a request needs Gmail access (to send the notification
   email) in addition to Sheets — you should see both requested in this
   consent screen. If you don't (or a submission later
   fails with a Mail permission error), see the `authorizeAdditionalScopes`
   troubleshooting step below.
5. Copy the **Web app URL** shown after deployment. It looks like:
   `https://script.google.com/macros/s/AKfycb.../exec`

## 4. Connect the website

Open `js/googleSheets.js` and paste your Web App URL into the
`SHEETS_API_URL` constant near the top of the file:

```js
var SHEETS_API_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
```

Save the file and reload `transfer.html` (or `rollforward.html`). The
Department and Account dropdowns on both pages will now populate from your
live spreadsheet — they share the exact same `SHEETS_API_URL`.

## 5. After editing the spreadsheet later

The website caches the Chart of Accounts for the current browser tab/session
so dropdowns feel instant. If you add or change departments/accounts in the
sheet, use the **Refresh Chart of Accounts** link on the form (or simply
close and reopen the tab) to pick up the changes — you do **not** need to
redeploy the Apps Script for data edits, only if you change `Code.gs` itself.

## 6. Set up Transfer Request submission (Sheets storage + email)

Clicking **Submit Transfer Request** on `transfer.html` sends the
completed form to the same Apps Script, which generates a PDF, records the
request across two more tabs in this workbook, and emails the PDF to
Budget Office staff. The PDF itself is never saved anywhere — it's built
fresh for each submission, attached to that email, and discarded. This
needs three more tabs, none of which existed for the read-only Chart of
Accounts setup above.

**Settings** — `Setting | Value` columns. One row per setting:

| Setting | Value |
|---|---|
| NotificationEmails | budget@county.gov;administrator@county.gov |
| FiscalYear | 2026 |
| RequestPrefix | BTR |

- `NotificationEmails` — semicolon-separated list; every address gets the
  Budget Office notification email for every submitted request, from
  **all four** workflows. Edit this list any time staffing changes — no
  redeploy needed, since it's read fresh on every submission.
- `FiscalYear` — used to build Request IDs for **all four** workflows:
  Transfer Request's `{FiscalYear}-000001` (e.g. `2026-000001`),
  Rollforward's `RF-{FiscalYear}-0001` (e.g. `RF-2026-0001`, see §7),
  Grant Amendment's `GR-{FiscalYear}-0001` (e.g. `GR-2026-0001`, see §8),
  and Budget Request's `BR-{FiscalYear}-0001` (e.g. `BR-2026-0001`, see
  §9). Update it whenever your fiscal year rolls over; each sequence
  starts back at its first number for the new year.
- `RequestPrefix` — stored for possible future use; the current Request ID
  format doesn't include it.

**Budget Transfer Requests** — one row per submitted request. Create the
sheet with this exact header row (Apps Script appends rows in this order,
not by header name, so the order must match):

`Request ID | Timestamp | Requestor Name | Requestor Email | Amendment Type | Department Code | Department Name | Justification | Total Transfer Amount | Resolution Number | Supporting Notes | Submission Status | Last Updated`

**Budget Transfer Lines** — one row per Transfer From/To line (every
submitted request produces multiple rows here). Header row, in order:

`Request ID | Line Number | Direction | Department Code | Department Name | Account Number | Account Description | Project Number | Revenue Code | Amount`

`Resolution Number` and `Supporting Notes` are intentionally left blank by
the script — the form doesn't collect them yet; they're there for a future
workflow to fill in without changing the sheet's structure.

## 7. Set up Fiscal Year Rollforward submission

Clicking **Submit Rollforward Request** on `rollforward.html` sends the
completed form to the exact same Apps Script deployment — no separate URL,
no separate deployment. The script tells the request types apart by a
`requestType` field the client sends automatically; you don't need to
configure anything for this. A single request can cover one or more
accounts (the requester adds more with **+ Add Another Rollforward
Request** on the page — one Department, but each account has its own
Expense Account, Amount, and Justification). The script generates one PDF
covering every account on the request, records one row **per account** in
a new sheet (all sharing the same Request ID), and emails the PDF to
Budget Office staff (the requester is **not** emailed, matching Transfer
Request's current behavior). Reuses the same `Settings` sheet from §6 —
no new settings needed.

**Rollforward Requests** — one row per account within a submitted request
(a request with 3 accounts writes 3 rows, all sharing one Request ID).
Create the sheet with this exact header row, in order:

`Timestamp | Request ID | Requester Name | Requester Email | Department Code | Department Name | Expense Account | Project Number | Contract or PO Number | Amount | Fiscal Year | Justification | Status | Submitted By | Request Date | Title`

Note the column order here is different from Budget Transfer Requests
(`Timestamp` comes before `Request ID`) — this matches how the sheet was
specified, and `Code.gs`'s `generateRequestId()` already knows to look in
the right column for each sheet.

**Important — column order is positional, not name-matched.** `Code.gs`
always writes values into columns A–P in the exact order listed above; it
never looks at your header text to figure out where a value belongs. If
you already have a `Rollforward Requests` sheet from before Contract or PO
Number existed, **insert a new column between Project Number and Amount**
(don't just append "Contract or PO Number" at the end) so the physical
column order still matches the list above — appending it at the end would
silently shift every column after Project Number one position out of
alignment with its header, the same kind of mismatch as a swapped/misplaced
header. If you already have a `Rollforward Requests` sheet from before the
form collected a Date and Title, **append `Request Date` and `Title` as
two new trailing columns** — since they're last, this is the one case
where appending (not inserting) is correct.

## 8. Set up Grant Amendment submission

Clicking **Submit Grant Amendment Request** on `grant.html` sends the
completed form to the exact same Apps Script deployment — no separate URL,
no separate deployment; the script tells the request types apart by the
`requestType` field the client sends automatically. Reuses the same
`Settings` sheet from §6 — no new settings needed.

Grant Amendment is structurally different from Transfer Request and
Rollforward/Budget Request: it never searches `COA Expenses` or `COA Revenue` for an
account. Instead the Revenue and Expense account numbers are **computed**
from four choices on the form, entirely server-side (the server never
trusts an account-number string the client sends, the same principle
Transfer Request already follows):

- **Expense Account** = Department Code + the selected category's object
  code + Grant Number, e.g. Department `00107010` + Equipment `564000`
  + Grant Number `12345` → `00107010-564000-12345`. Category → object
  code: Equipment `564000`, Construction `563000`, Design `531000`,
  Salaries `512000`, Other `534000`.
- **Revenue Account** = `[Fund + Grant Type code]` + `[Grant Type code +
  Activity code]` + Grant Number, where Fund is the first 3 digits of
  the Department Code and Grant Type code is `331` (Federal) or `334`
  (State). E.g. Department `00107010` (fund `001`) + State + Activity
  `500` (Economic Environment) + Grant Number `12345` →
  `001334-334500-12345`. The Activity list comes from the Florida
  Accounting Manual (Rule 69I-51.0012, F.A.C.) — see `ACTIVITY_CODES` in
  `js/grant.js` (mirrored server-side in `Code.gs`'s
  `buildGrantAccountNumbers()`) for the full 331.xxx/334.xxx code list.

A submission produces exactly one Revenue line and one Expense line (both
share the entered Amount), so unlike Rollforward this only needs one row
per request, not a separate lines sheet. Unlike Transfer Request/
Rollforward/Budget Request, there's no Description field — the Revenue/Expense account
pair and Grant Number are the record.

**Grant Amendment Requests** — one row per submitted request. Create the
sheet with this exact header row, in order:

`Request ID | Timestamp | Prepared By | Title | Requestor Email | Grant Source | Activity Code | Activity Label | Department Code | Department Name | Category | Revenue Account | Expense Account | Amount | Grant Number | Status | Granting Agency | Grant Program Name | Board Approval Date`

The last three columns (Granting Agency, Grant Program Name, Board
Approval Date) feed the Generate Grant Resolution document on the page —
Board Approval Date in particular becomes the resolution's adoption date.

## 9. Set up Budget Request submission

Clicking **Submit Budget Request** on `budget-request.html` sends the
completed form to the exact same Apps Script deployment — no separate URL,
no separate deployment; the script tells the request types apart by the
`requestType` field the client sends automatically. Reuses the same
`Settings` sheet from §6 — no new settings needed.

Budget Request is the portal's newest workflow: requesting **new**
funding for next fiscal year, as opposed to Transfer Request (moving
existing budget between accounts, net-zero) or Rollforward (carrying
unspent budget into next year). Structurally it's nearly identical to
Rollforward — a single request can cover one or more accounts (the
requester adds more with **+ Add Another Requested Account** on the page
— one Department and Fiscal Year, but each account has its own Expense
Account, an optional Current FY Budget for reference, a Requested Amount,
and a Justification). The script generates one PDF covering every account
on the request, records one row **per account** in a new sheet (all
sharing the same Request ID), and emails the PDF to Budget Office staff
(the requester is **not** emailed, matching Transfer Request/Rollforward's
current behavior).

**Budget Requests** — one row per account within a submitted request (a
request with 3 accounts writes 3 rows, all sharing one Request ID).
Create the sheet with this exact header row, in order:

`Timestamp | Request ID | Requester Name | Requester Email | Department Code | Department Name | Expense Account | Project Number | Current FY Budget | Requested Amount | Fiscal Year | Justification | Status | Submitted By | Request Date | Title`

Same column order convention as Rollforward Requests (`Timestamp` before
`Request ID`) — `Code.gs`'s `generateRequestId()` is told which column
via its `idColumnIndex` argument, so this only matters if you're building
the sheet by hand rather than letting the script create rows for you.

## Troubleshooting

- **"Chart of Accounts is not configured yet" banner** — `SHEETS_API_URL` in
  `js/googleSheets.js` is still the placeholder. Complete step 4 above.
- **"Sheet not found" error** — a tab name doesn't match exactly (check for
  extra spaces or a typo in `COA Departments` / `COA Expenses` / `COA Revenue`).
- **Dropdowns load but are empty** — check that the header row in the
  relevant tab matches the exact column names listed in step 1.
- **Changed `Code.gs` but nothing changed on the site** — edits to the script
  require a **new deployment** (Deploy → Manage deployments → Edit → New
  version) to take effect; saving alone isn't enough for an existing
  deployment's URL to pick up changes.
- **Department search works, but its account dropdowns show nothing** —
  department codes are often entered with leading zeros in COA Departments
  (e.g. `00107000`) but without them on COA Expenses/COA Revenue rows (e.g.
  `107000`). `Code.gs` normalizes both sides (strips leading zeros) before
  comparing, so this should already be handled — if it's still happening,
  double-check the department code actually appears (in any zero-padded
  form) on the corresponding Expense/Revenue rows at all.
- **Submission fails with a "Sheet not found" error** — one of the §6/§7/§8
  tabs (`Settings`, `Budget Transfer Requests`, `Budget Transfer Lines`,
  `Rollforward Requests`, `Grant Amendment Requests`) is missing or
  misnamed. The error message names which one.
- **Submission fails with "You do not have permission to call
  MailApp..."** — the account that deployed the script hasn't granted
  Gmail access yet, and deploying a "new version" doesn't reliably
  re-prompt for a scope the script didn't need before. Fix: in the Apps
  Script editor, select **authorizeAdditionalScopes** in the function
  dropdown next to Run, click **Run**, and click through the permission
  prompt (it doesn't matter if the run itself reports an error afterward —
  the point is triggering the consent screen). Your existing deployment
  URL doesn't change; it'll just start working once the scope is granted.
- **No emails arrive, but the request appears in Sheets** — check
  `NotificationEmails` in Settings for typos or expired addresses. The
  Sheets write and email sending are independent steps; a request can be
  fully saved even if the notification email fails to send.
- **Want more detail on a failed submission** — open the Apps Script editor
  → **Executions** (left sidebar) → find the failed `doPost` run. The full
  error and stack trace are logged there even though the website only shows
  a short message.
