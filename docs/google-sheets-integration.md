# Chart of Accounts — Google Sheets Integration

The Department and Account dropdowns are driven live by a Google Sheets
workbook, read through a small Google Apps Script "Web App" that you deploy
yourself. This keeps your spreadsheet completely private — no API key is
ever embedded in the website's code, and nothing needs to be shared publicly.

## 1. Prepare the spreadsheet

Your workbook needs exactly three tabs, with these exact header rows (column
order doesn't matter, but the header **text** must match exactly):

**COA Departments**

| Department Code | Department Name |
|---|---|
| 101 | Administration |
| 205 | Public Works |
| 310 | Parks & Recreation |

**COA Expenses** (a `Project` column is fine to have — it's ignored)

| Department Code | Expense Object | Expense Object Name | Project |
|---|---|---|---|
| 205 | 531100 | Office Supplies | ... |
| 205 | 552000 | Travel | ... |
| 310 | 564100 | Computer Equipment | ... |

**COA Revenue** — note the different column names on this tab: `Org Code` is
treated as the department code, `Object Code` as the revenue code, and
`Name` as the revenue name.

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
