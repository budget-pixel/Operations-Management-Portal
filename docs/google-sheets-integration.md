# Chart of Accounts — Google Sheets Integration

The Department and Account dropdowns are driven live by a Google Sheets
workbook, read through a small Google Apps Script "Web App" that you deploy
yourself. This keeps your spreadsheet completely private — no API key is
ever embedded in the website's code, and nothing needs to be shared publicly.
The same Apps Script also *receives* submitted requests (§6 below): it
generates a PDF, saves it to Drive, records the request in two more tabs in
this same workbook, and emails the PDF to staff and the requestor.

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
   Submitting a request needs Gmail (to send the notification/confirmation
   emails) and Drive (to save the PDF) access in addition to Sheets — you'll
   see all three requested in this consent screen.
5. Copy the **Web app URL** shown after deployment. It looks like:
   `https://script.google.com/macros/s/AKfycb.../exec`

## 4. Connect the website

Open `js/googleSheets.js` and paste your Web App URL into the
`SHEETS_API_URL` constant near the top of the file:

```js
var SHEETS_API_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
```

Save the file and reload `index.html`. The Department and Account dropdowns
will now populate from your live spreadsheet.

## 5. After editing the spreadsheet later

The website caches the Chart of Accounts for the current browser tab/session
so dropdowns feel instant. If you add or change departments/accounts in the
sheet, use the **Refresh Chart of Accounts** link on the form (or simply
close and reopen the tab) to pick up the changes — you do **not** need to
redeploy the Apps Script for data edits, only if you change `Code.gs` itself.

## 6. Set up request submission (Sheets storage, PDF, email)

Clicking **Submit Budget Transfer Request** on the site sends the completed
form to the same Apps Script, which generates a PDF, saves it to a Drive
folder you choose, records the request across two more tabs in this
workbook, and emails the PDF to county staff and the requestor. This needs
three more tabs and one Drive folder, none of which existed for the
read-only Chart of Accounts setup above.

**Settings** — `Setting | Value` columns. One row per setting:

| Setting | Value |
|---|---|
| NotificationEmails | budget@county.gov;administrator@county.gov |
| PDFFolderId | 1AbCdEfGhIjKlMnOpQrStUvWxYz |
| FiscalYear | 2026 |
| RequestPrefix | BTR |

- `NotificationEmails` — semicolon-separated list; every address gets the
  county notification email for every submitted request. Edit this list any
  time staffing changes — no redeploy needed, since it's read fresh on every
  submission.
- `PDFFolderId` — the Drive folder submitted PDFs are saved into. Create or
  choose a folder in Drive, open it, and copy the ID out of its URL
  (`https://drive.google.com/drive/folders/`**`1AbCdEfGhIjKlMnOpQrStUvWxYz`**).
  The account that deployed the Apps Script needs write access to this folder.
- `FiscalYear` — used to build Request IDs (`{FiscalYear}-000001`, e.g.
  `2026-000001`). Update it whenever your fiscal year rolls over; the
  sequence number for a new year starts back at `000001`.
- `RequestPrefix` — stored for possible future use; the current Request ID
  format doesn't include it.

**Budget Transfer Requests** — one row per submitted request. Create the
sheet with this exact header row (Apps Script appends rows in this order,
not by header name, so the order must match):

`Request ID | Timestamp | Requestor Name | Requestor Email | Amendment Type | Department Code | Department Name | Justification | Total Transfer Amount | Resolution Number | Supporting Notes | PDF File ID | PDF File URL | Submission Status | Last Updated`

**Budget Transfer Lines** — one row per Transfer From/To line (every
submitted request produces multiple rows here). Header row, in order:

`Request ID | Line Number | Direction | Department Code | Department Name | Account Number | Account Description | Project Number | Revenue Code | Amount`

`Resolution Number` and `Supporting Notes` are intentionally left blank by
the script — the form doesn't collect them yet; they're there for a future
workflow to fill in without changing the sheet's structure.

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
- **Submission fails with a Sheets/Settings/PDFFolderId error** — one of the
  §6 tabs is missing, misnamed, or `PDFFolderId` in Settings is blank/wrong.
  The error message names which one.
- **Submission fails with a Drive permission error** — the Google account
  that deployed the Apps Script doesn't have write access to the folder
  named by `PDFFolderId`.
- **No emails arrive, but the request appears in Sheets/Drive** — check
  `NotificationEmails` in Settings for typos, and check the requestor's
  spam folder. Sheets/Drive writes and email sending are independent steps;
  a request can be fully saved even if an email address is wrong.
- **Want more detail on a failed submission** — open the Apps Script editor
  → **Executions** (left sidebar) → find the failed `doPost` run. The full
  error and stack trace are logged there even though the website only shows
  a short message.
