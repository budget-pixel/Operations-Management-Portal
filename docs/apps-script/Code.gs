/**
 * Budget Amendment Request — Chart of Accounts JSON proxy + submission
 * backend.
 *
 * Paste this entire file into the Apps Script editor of a script bound to
 * your Chart of Accounts spreadsheet (Extensions -> Apps Script). It reads
 * the COA tabs for the website's dropdowns (doGet) and, separately,
 * receives completed Budget Transfer Requests (doPost): generates a PDF,
 * records the request in two normalized worksheets, and emails the PDF to
 * Budget Office staff. The PDF is never saved anywhere (no Google Drive) —
 * it exists only in memory for as long as it takes to attach it to that
 * outgoing email.
 *
 * Expected tabs and exact header row text:
 *
 *   "COA Departments"          Department Code | Department Name
 *   "COA Expenses"             Department Code | Expense Object | Expense Object Name | Project
 *   "COA Revenue"              Org Code | Object Code | Name  (Project, if present, is ignored)
 *   "Settings"                 Setting | Value  (see getSettings() below)
 *   "Budget Transfer Requests" one row per submitted request (see appendRequestRow())
 *   "Budget Transfer Lines"    one row per Transfer From/To line (see appendLineRows())
 *
 * COA Expenses and COA Revenue don't carry a department *name* column, only
 * a code (Department Code / Org Code) — departmentName comes back blank for
 * those two, which is fine since only departmentCode is used for filtering.
 *
 * Some COA Expenses rows are already tied to a specific project number in
 * their Project column — that comes back as projectCode so the client can
 * search by it and auto-fill it once that account is selected.
 *
 * Notification recipients, the fiscal year, and the (currently unused)
 * Request ID prefix are NOT hardcoded here — they're read from the
 * "Settings" sheet on every submission, so staff can update them without
 * touching this file. See getSettings().
 *
 * Deploying doPost for the first time adds a new required scope (Gmail,
 * to send the notification email) beyond doGet's read-only Sheets access.
 * Deploying a "new version" of an existing deployment does
 * NOT reliably re-prompt for that new scope on its own — see
 * authorizeAdditionalScopes() below if doPost fails with a permission
 * error on MailApp.
 *
 * See docs/google-sheets-integration.md for full setup steps.
 */

// =============================================================
// One-time manual authorization helper
// =============================================================

/**
 * Not called by the website — run this ONCE manually from the Apps
 * Script editor (select "authorizeAdditionalScopes" in the function
 * dropdown next to Run, then click Run) after adding doPost, or any time
 * doPost fails with a "You do not have permission to call MailApp..."
 * error.
 *
 * Deploying a "new version" of an existing deployment does not reliably
 * re-prompt for a scope the script didn't need before (Gmail, here). And
 * running doGet or doPost directly doesn't help either — doGet never
 * touches Mail so there's nothing new to authorize, and doPost crashes
 * immediately on its missing event parameter before it ever reaches the
 * Mail call. This function's only job is to touch MailApp directly (no
 * side effects — getRemainingDailyQuota() doesn't send anything) so the
 * editor's authorization prompt has something to ask about. Once you
 * click through that prompt, the deployed Web App (which runs as your
 * account) has the same grant and doPost's real MailApp.sendEmail() calls
 * will work.
 */
function authorizeAdditionalScopes() {
  MailApp.getRemainingDailyQuota();
}

// =============================================================
// Chart of Accounts read endpoint (unchanged)
// =============================================================

function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var payload = {
      departments: readSheet(ss, 'COA Departments', mapDepartmentRow),
      expenses: readSheet(ss, 'COA Expenses', mapExpenseRow),
      revenue: readSheet(ss, 'COA Revenue', mapRevenueRow),
      fetchedAt: new Date().toISOString(),
    };
    return jsonResponse(payload);
  } catch (err) {
    return jsonResponse({ error: String(err && err.message ? err.message : err) });
  }
}

// Reads a sheet by name, using its header row to key each row into an
// object, then maps every row through mapRow. Skips fully blank rows.
function readSheet(ss, sheetName, mapRow) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('Sheet not found: "' + sheetName + '". Check the tab name matches exactly.');
  }

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var headers = values[0].map(function (header) {
    return String(header).trim();
  });

  return values
    .slice(1)
    .filter(function (row) {
      return row.some(function (cell) {
        return cell !== '' && cell !== null;
      });
    })
    .map(function (row) {
      var record = {};
      headers.forEach(function (header, i) {
        record[header] = row[i];
      });
      return mapRow(record);
    });
}

function cell(record, header) {
  var value = record[header];
  return value === undefined || value === null ? '' : String(value).trim();
}

// COA Departments codes are entered with leading zeros (e.g. "00107000"),
// but the same code appears without them on COA Expenses/COA Revenue rows
// (e.g. "107000"). department.code keeps the original padded value (it's
// the real account number staff enter elsewhere, and must display exactly
// as-is) — matchCode is the normalized value used only for joining against
// Expenses/Revenue, never shown to the user.
function normalizeDeptCode(value) {
  var stripped = String(value).trim().replace(/^0+/, '');
  return stripped === '' ? '0' : stripped;
}

function mapDepartmentRow(record) {
  var rawCode = cell(record, 'Department Code');
  return {
    code: rawCode,
    matchCode: normalizeDeptCode(rawCode),
    name: cell(record, 'Department Name'),
  };
}

function mapExpenseRow(record) {
  return {
    departmentCode: normalizeDeptCode(cell(record, 'Department Code')),
    departmentName: '',
    code: cell(record, 'Expense Object'),
    name: cell(record, 'Expense Object Name'),
    // Some rows already have a specific project tied to them in the sheet —
    // blank for the (majority of) rows that don't.
    projectCode: cell(record, 'Project'),
  };
}

function mapRevenueRow(record) {
  return {
    // Org Code / Object Code / Name are this sheet's actual header names.
    departmentCode: normalizeDeptCode(cell(record, 'Org Code')),
    departmentName: '',
    code: cell(record, 'Object Code'),
    name: cell(record, 'Name'),
  };
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// =============================================================
// Submission endpoint
// =============================================================

// Amendment type value -> human-readable label with statute reference,
// mirrors js/amendmentRules.js / the radio option text in index.html.
var AMENDMENT_TYPE_LABELS = {
  intradepartmental: 'Intradepartmental Amendment (Fl. St. 129.06(2)(a))',
  interdepartmental: 'Interdepartmental Amendment (Fl. St. 129.06(2)(b))',
  reserve: 'Reserve for future construction and improvements (Fl. St. 129.06(2)(c))',
  unanticipatedRevenue: 'Unanticipated revenue (Fl. St. 129.06(2)(d))',
  increasedReceipts: 'Increased receipts for enterprise fund (Fl. St. 129.06(2)(e))',
  publicHearing: 'Requires Public Hearing (Fl. St. 129.06(2)(f))',
};

// Amendment type value -> 'single' (one department governs both transfer
// sides) or 'dual' (Transfer From/To each have their own department).
// Mirrors js/amendmentRules.js.
var DEPARTMENT_MODE_BY_TYPE = {
  intradepartmental: 'single',
  interdepartmental: 'dual',
  reserve: 'dual',
  unanticipatedRevenue: 'dual',
  increasedReceipts: 'dual',
  publicHearing: 'dual',
};

/**
 * Handles a submitted Budget Transfer Request from the website.
 *
 * Input: e.postData.contents — a JSON string matching the client's
 * collectFormData() output (see js/app.js), plus requestorEmail. The
 * client sends this with no explicit Content-Type header on purpose: Apps
 * Script Web Apps can't handle a CORS preflight (OPTIONS) request, and a
 * plain-string fetch() body defaults to "text/plain", which browsers
 * exempt from preflight. We just parse the raw body as JSON regardless of
 * what Content-Type was declared.
 *
 * Output: a JSON response { success: true, requestId } on success, or
 * { success: false, error } on failure (validation or otherwise). Never
 * throws — every failure path is caught and reported in the response body
 * so the client always gets a definite answer instead of hanging.
 */
function doPost(e) {
  try {
    var requestData = JSON.parse(e.postData.contents);

    var validationErrors = validateSubmission(requestData);
    if (validationErrors.length > 0) {
      return jsonResponse({ success: false, error: validationErrors.join(' ') });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var settings = getSettings(ss);
    var requestId = generateRequestId(ss, settings.FiscalYear);
    var timestamp = new Date();

    var lines = buildTransferLines(requestData);
    var totalAmount = sumLineAmounts(lines, 'Transfer From');

    // One PDF blob, built once, reused for both emails below — never
    // written to Drive or anywhere else, so it only exists for the
    // lifetime of this request.
    var pdfBlob = buildRequestPdf(requestData, requestId, timestamp, lines, totalAmount);

    // Written as a pair, with a rollback if the second write fails, so a
    // request row is never left in the sheet with no matching lines (an
    // incomplete/orphaned record) — see writeRequestAndLines().
    writeRequestAndLines(ss, {
      requestId: requestId,
      timestamp: timestamp,
      requestData: requestData,
      totalAmount: totalAmount,
      lines: lines,
    });

    sendCountyNotification(settings, requestData, requestId, timestamp, totalAmount, pdfBlob);

    return jsonResponse({
      success: true,
      requestId: requestId,
    });
  } catch (err) {
    // Full stack goes to the Apps Script execution log (Executions tab)
    // for troubleshooting; the client only sees a plain message.
    console.error('doPost failed: ' + (err && err.stack ? err.stack : err));
    return jsonResponse({ success: false, error: String(err && err.message ? err.message : err) });
  }
}

// ---------- Settings ----------

/**
 * Reads the "Settings" sheet (Setting | Value columns) into a typed
 * object. Read fresh on every request — submission volume here is far too
 * low to need caching, and staff editing Settings should take effect
 * immediately.
 *
 * Output shape: { NotificationEmails: string[], FiscalYear: string,
 * RequestPrefix: string }.
 */
function getSettings(ss) {
  var sheet = ss.getSheetByName('Settings');
  if (!sheet) {
    throw new Error('Sheet not found: "Settings". Create it with Setting/Value columns first.');
  }

  var values = sheet.getDataRange().getValues();
  var raw = {};
  values.slice(1).forEach(function (row) {
    var key = String(row[0] || '').trim();
    if (key) raw[key] = String(row[1] || '').trim();
  });

  return {
    NotificationEmails: (raw.NotificationEmails || '')
      .split(';')
      .map(function (email) { return email.trim(); })
      .filter(Boolean),
    FiscalYear: raw.FiscalYear || String(new Date().getFullYear()),
    // Not used in the Request ID format yet (see generateRequestId) —
    // stored now so switching formats later doesn't need a code change.
    RequestPrefix: raw.RequestPrefix || '',
  };
}

// ---------- Request ID ----------

/**
 * Generates the next sequential Request ID for a fiscal year, e.g.
 * "2026-000001". Guarded by a script lock so two submissions arriving at
 * nearly the same moment can't both compute the same next number.
 *
 * Input: the spreadsheet and the fiscal year string from Settings.
 * Output: a string like "2026-000042".
 */
function generateRequestId(ss, fiscalYear) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = ss.getSheetByName('Budget Transfer Requests');
    if (!sheet) {
      throw new Error('Sheet not found: "Budget Transfer Requests".');
    }

    var idPrefix = fiscalYear + '-';
    var values = sheet.getDataRange().getValues();
    var count = 0;
    for (var i = 1; i < values.length; i += 1) {
      var existingId = String(values[i][0] || '');
      if (existingId.indexOf(idPrefix) === 0) {
        count += 1;
      }
    }

    var nextNumber = count + 1;
    var padded = ('000000' + nextNumber).slice(-6);
    return idPrefix + padded;
  } finally {
    lock.releaseLock();
  }
}

// ---------- Validation (server-side defense in depth) ----------

/**
 * Re-validates the submission server-side — the client already validates,
 * but a request could reach doPost some other way, and this is the last
 * line of defense before anything is written or emailed.
 *
 * Input: the parsed request payload.
 * Output: an array of human-readable error strings (empty = valid).
 */
function validateSubmission(data) {
  var errors = [];

  if (!data || typeof data !== 'object') {
    return ['Malformed request payload.'];
  }
  if (!data.date) errors.push('Date is required.');
  if (!data.description) errors.push('Description is required.');
  if (!data.preparedBy) errors.push('Prepared By is required.');
  if (!data.title) errors.push('Title is required.');
  if (!data.requestorEmail || !isValidEmailFormat(data.requestorEmail)) {
    errors.push('A valid Requestor Email Address is required.');
  }
  if (!data.amendmentType || !AMENDMENT_TYPE_LABELS[data.amendmentType]) {
    errors.push('A valid amendment type is required.');
  }

  var fromLines = Array.isArray(data.transferFrom) ? data.transferFrom.filter(hasAccount) : [];
  var toLines = Array.isArray(data.transferTo) ? data.transferTo.filter(hasAccount) : [];

  if (fromLines.length === 0) errors.push('At least one Transfer From account is required.');
  if (toLines.length === 0) errors.push('At least one Transfer To account is required.');

  var fromTotal = sumAmounts(fromLines);
  var toTotal = sumAmounts(toLines);
  if (fromTotal.toFixed(2) !== toTotal.toFixed(2)) {
    errors.push('Transfer From and Transfer To totals must match.');
  }

  return errors;
}

function hasAccount(line) {
  return !!(line && line.account && line.account.code);
}

function sumAmounts(lines) {
  return lines.reduce(function (sum, line) {
    var amount = parseFloat(line.amount);
    return sum + (isFinite(amount) ? amount : 0);
  }, 0);
}

function isValidEmailFormat(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

// ---------- Transfer lines (shared by the Sheets writer and the PDF) ----------

function getDepartmentModeForType(amendmentType) {
  return DEPARTMENT_MODE_BY_TYPE[amendmentType] || 'dual';
}

// Returns the { code, name } department object governing one side of the
// transfer, accounting for single- vs dual-department amendment types.
function getDepartmentForSection(data, section) {
  var mode = getDepartmentModeForType(data.amendmentType);
  if (mode === 'single') {
    return data.department || null;
  }
  return section === 'transferFrom' ? (data.departmentFrom || null) : (data.departmentTo || null);
}

// "DeptCode-ObjectCode[-ProjectCode]" — matches the composite number
// already shown to the user client-side (js/app.js's buildAccountNumber).
function buildAccountNumber(departmentDisplayCode, account, projectCode) {
  var parts = [departmentDisplayCode, account.code];
  if (projectCode) parts.push(projectCode);
  return parts.filter(Boolean).join('-');
}

/**
 * Flattens both transfer sections into one array of line-ready objects —
 * the single place "what counts as a line" is decided, reused by the
 * Sheets writer, the PDF, and total calculations so they can never drift
 * apart from each other.
 *
 * Input: the request payload.
 * Output: array of { lineNumber, direction, departmentCode,
 * departmentName, accountNumber, accountDescription, projectNumber,
 * revenueCode, amount, section }, numbered sequentially across both
 * directions in the order they appear.
 */
function buildTransferLines(data) {
  var lines = [];
  var lineNumber = 0;

  ['transferFrom', 'transferTo'].forEach(function (section) {
    var direction = section === 'transferFrom' ? 'Transfer From' : 'Transfer To';
    var department = getDepartmentForSection(data, section);
    var departmentDisplayCode = department ? department.code : '';
    var departmentName = department ? department.name : '';
    var rows = Array.isArray(data[section]) ? data[section] : [];

    rows.filter(hasAccount).forEach(function (row) {
      lineNumber += 1;
      var account = row.account;
      var accountNumber = buildAccountNumber(departmentDisplayCode, account, row.projectCode);

      lines.push({
        lineNumber: lineNumber,
        direction: direction,
        departmentCode: departmentDisplayCode,
        departmentName: departmentName,
        accountNumber: accountNumber,
        accountDescription: account.name,
        projectNumber: row.projectCode || '',
        // Only meaningful for revenue-type lines — blank for expense lines.
        revenueCode: account.type === 'revenue' ? accountNumber : '',
        amount: parseFloat(row.amount) || 0,
        section: section,
      });
    });
  });

  return lines;
}

function sumLineAmounts(lines, direction) {
  return lines
    .filter(function (line) { return line.direction === direction; })
    .reduce(function (sum, line) { return sum + line.amount; }, 0);
}

// ---------- Sheets writers ----------

/**
 * Writes both sheet rows for one request as a pair: the request summary
 * row, then its transfer lines. If the lines write fails, the just-added
 * request row is deleted before re-throwing — a request row with zero
 * matching lines would be exactly the kind of incomplete/orphaned record
 * doPost must not leave behind.
 *
 * Input: the spreadsheet, and { requestId, timestamp, requestData,
 * totalAmount, lines }.
 * Output: none. Throws on failure (after rolling back the request row).
 */
function writeRequestAndLines(ss, params) {
  var requestRowNumber = appendRequestRow(ss, params);
  try {
    appendLineRows(ss, params.requestId, params.lines);
  } catch (err) {
    var requestsSheet = ss.getSheetByName('Budget Transfer Requests');
    if (requestsSheet && requestRowNumber) {
      requestsSheet.deleteRow(requestRowNumber);
    }
    throw new Error(
      'Could not record transfer lines (request row rolled back): '
      + (err && err.message ? err.message : err)
    );
  }
}

/**
 * Appends one row to "Budget Transfer Requests".
 * Columns: Request ID, Timestamp, Requestor Name, Requestor Email,
 * Amendment Type, Department Code, Department Name, Justification, Total
 * Transfer Amount, Resolution Number, Supporting Notes, Submission
 * Status, Last Updated.
 *
 * Resolution Number / Supporting Notes are intentionally left blank — the
 * form doesn't collect them yet; they're here for a later workflow to
 * fill in without a schema change.
 *
 * Output: the 1-based row number the request was written to (so
 * writeRequestAndLines can roll it back if the lines write fails).
 */
function appendRequestRow(ss, params) {
  var sheet = ss.getSheetByName('Budget Transfer Requests');
  if (!sheet) {
    throw new Error('Sheet not found: "Budget Transfer Requests".');
  }

  var data = params.requestData;
  var mode = getDepartmentModeForType(data.amendmentType);
  // For dual-department requests there's no single "the" department — the
  // Transfer From department is used as a convenience reference; the
  // Lines sheet has full per-line department fidelity for both sides.
  var requestDept = mode === 'single' ? data.department : data.departmentFrom;

  sheet.appendRow([
    params.requestId,
    params.timestamp,
    data.preparedBy || '',
    data.requestorEmail || '',
    AMENDMENT_TYPE_LABELS[data.amendmentType] || data.amendmentType || '',
    requestDept ? requestDept.code : '',
    requestDept ? requestDept.name : '',
    data.description || '',
    params.totalAmount,
    '',
    '',
    'Submitted',
    params.timestamp,
  ]);

  return sheet.getLastRow();
}

/**
 * Appends one row per transfer line to "Budget Transfer Lines".
 * Columns: Request ID, Line Number, Direction, Department Code,
 * Department Name, Account Number, Account Description, Project Number,
 * Revenue Code, Amount.
 */
function appendLineRows(ss, requestId, lines) {
  var sheet = ss.getSheetByName('Budget Transfer Lines');
  if (!sheet) {
    throw new Error('Sheet not found: "Budget Transfer Lines".');
  }
  if (lines.length === 0) return;

  var rows = lines.map(function (line) {
    return [
      requestId,
      line.lineNumber,
      line.direction,
      line.departmentCode,
      line.departmentName,
      line.accountNumber,
      line.accountDescription,
      line.projectNumber,
      line.revenueCode,
      line.amount,
    ];
  });

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

// ---------- PDF ----------

/**
 * Builds the one PDF blob used for BOTH outgoing emails (no duplicated
 * PDF-generation logic — every caller in doPost shares this exact blob).
 * Converts a simple, self-contained HTML document to PDF via Apps
 * Script's blob MIME conversion, which doesn't need a temporary Google
 * Doc for HTML this simple (headings, text, and bordered tables). This
 * blob is never written to Drive or anywhere else — it only exists in
 * memory for the lifetime of this request, purely to attach to the two
 * emails below.
 *
 * Input: the request payload, its Request ID, submission timestamp, the
 * flattened transfer lines, and the (Transfer From) total amount.
 * Output: a Blob with MIME type application/pdf.
 */
function buildRequestPdf(data, requestId, timestamp, lines, totalAmount) {
  var html = buildRequestHtml(data, requestId, timestamp, lines, totalAmount);
  var htmlBlob = Utilities.newBlob(html, 'text/html', 'request.html');
  var pdfBlob = htmlBlob.getAs('application/pdf');
  pdfBlob.setName('Budget-Transfer-Request-' + requestId + '.pdf');
  return pdfBlob;
}

// Mirrors the client's print view layout (index.html's #printView /
// js/app.js's populatePrintView()) closely enough to look like the same
// document, without literally sharing code across the browser/Apps Script
// runtime boundary.
function buildRequestHtml(data, requestId, timestamp, lines, totalAmount) {
  var fromLines = lines.filter(function (line) { return line.direction === 'Transfer From'; });
  var toLines = lines.filter(function (line) { return line.direction === 'Transfer To'; });
  var toTotal = sumLineAmounts(lines, 'Transfer To');

  var mode = getDepartmentModeForType(data.amendmentType);
  var departmentLineHtml = mode === 'single'
    ? '<b>Department:</b> ' + escapeHtml(formatDepartmentForDisplay(data.department))
    : '<b>Transfer From Dept:</b> ' + escapeHtml(formatDepartmentForDisplay(data.departmentFrom))
      + '&nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp;'
      + '<b>Transfer To Dept:</b> ' + escapeHtml(formatDepartmentForDisplay(data.departmentTo));

  var css = ''
    + 'body{font-family:Arial,Helvetica,sans-serif;color:#172033;font-size:11px;margin:24px;}'
    + 'h1{font-family:Georgia,"Times New Roman",serif;font-weight:500;font-size:20px;color:#003f28;margin:0 0 10px;}'
    + '.meta{margin:2px 0;font-size:11px;}'
    + '.meta b{color:#003f28;}'
    + '.tables{margin-top:16px;}'
    + '.table-col{display:inline-block;width:48%;vertical-align:top;}'
    + '.table-col + .table-col{margin-left:3%;}'
    + 'h2{font-size:13px;margin:0 0 4px;color:#003f28;}'
    // table-layout:fixed + the matching <colgroup> in buildLinesTableHtml
    // (33/42/25) keep both tables' column widths identical regardless of
    // content length — without this, a wrapping Description/Account
    // Number cell in one table (like a project-code account number) makes
    // its columns auto-size wider than the other table's, so the two
    // tables visibly don't line up. Mirrors the client print view's
    // .print-table CSS (css/styles.css), which uses the same fix.
    + 'table{border-collapse:collapse;width:100%;table-layout:fixed;}'
    + 'th,td{border:1px solid #999999;padding:4px 6px;text-align:left;font-size:10px;word-wrap:break-word;}'
    + 'th{background:#f6f8f5;}'
    + 'td:last-child,th:last-child{text-align:right;white-space:nowrap;}'
    + '.total{text-align:right;font-weight:bold;margin-top:4px;font-size:10px;}';

  return '<html><head><meta charset="UTF-8"><style>' + css + '</style></head><body>'
    + '<h1>Budget Amendment Request</h1>'
    + '<div class="meta"><b>Request ID:</b> ' + escapeHtml(requestId) + '</div>'
    + '<div class="meta"><b>Date:</b> ' + escapeHtml(formatDateForDisplay(data.date))
      + '&nbsp;&nbsp;&nbsp;<b>Prepared By:</b> ' + escapeHtml(data.preparedBy || '')
      + '&nbsp;&nbsp;&nbsp;<b>Title:</b> ' + escapeHtml(data.title || '') + '</div>'
    + '<div class="meta"><b>Amendment Type:</b> ' + escapeHtml(AMENDMENT_TYPE_LABELS[data.amendmentType] || '') + '</div>'
    + '<div class="meta">' + departmentLineHtml + '</div>'
    + (data.description ? '<div class="meta"><b>Description:</b> ' + escapeHtml(data.description) + '</div>' : '')
    + '<div class="tables">'
    + '<div class="table-col"><h2>Transfer From</h2>' + buildLinesTableHtml(fromLines)
      + '<div class="total">Total: ' + formatCurrency(totalAmount) + '</div></div>'
    + '<div class="table-col"><h2>Transfer To</h2>' + buildLinesTableHtml(toLines)
      + '<div class="total">Total: ' + formatCurrency(toTotal) + '</div></div>'
    + '</div>'
    + '</body></html>';
}

function buildLinesTableHtml(lines) {
  var rowsHtml = lines.map(function (line) {
    return '<tr><td>' + escapeHtml(line.accountNumber) + '</td>'
      + '<td>' + escapeHtml(line.accountDescription) + '</td>'
      + '<td>' + formatCurrency(line.amount) + '</td></tr>';
  }).join('');

  return '<table><colgroup><col style="width:33%"><col style="width:42%"><col style="width:25%"></colgroup>'
    + '<thead><tr><th>Account Number</th><th>Description</th><th>Amount</th></tr></thead>'
    + '<tbody>' + rowsHtml + '</tbody></table>';
}

// ---------- Email ----------

/**
 * Emails the submitted request's PDF to every address in
 * Settings!NotificationEmails. Silently does nothing if that list is
 * empty (unconfigured) rather than failing the whole submission over a
 * missing setting — the request is still saved to Sheets either way.
 */
function sendCountyNotification(settings, data, requestId, timestamp, totalAmount, pdfBlob) {
  if (settings.NotificationEmails.length === 0) return;

  var mode = getDepartmentModeForType(data.amendmentType);
  var department = mode === 'single' ? data.department : data.departmentFrom;

  var body = 'A Budget Transfer Request has been submitted.\n\n'
    + 'Request ID:\n' + requestId + '\n\n'
    + 'Department:\n' + (department ? department.name : '—') + '\n\n'
    + 'Amendment Type:\n' + (AMENDMENT_TYPE_LABELS[data.amendmentType] || '') + '\n\n'
    + 'Total Transfer Amount:\n' + formatCurrency(totalAmount) + '\n\n'
    + 'Submitted By:\n' + (data.preparedBy || '') + '\n\n'
    + 'Requestor Email:\n' + (data.requestorEmail || '') + '\n\n'
    + 'Submission Date:\n' + formatTimestampForEmail(timestamp) + '\n\n'
    + 'The completed Budget Transfer Request is attached.';

  MailApp.sendEmail({
    to: settings.NotificationEmails.join(','),
    subject: 'Budget Transfer Request Submitted – Request #' + requestId,
    body: body,
    attachments: [pdfBlob],
  });
}

// ---------- Formatting helpers ----------

function formatDepartmentForDisplay(dept) {
  return dept ? (dept.code + ' - ' + dept.name) : '—';
}

function formatDateForDisplay(isoDate) {
  if (!isoDate) return '—';
  var parts = String(isoDate).split('-');
  return parts.length === 3 ? (parts[1] + '/' + parts[2] + '/' + parts[0]) : String(isoDate);
}

function formatTimestampForEmail(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'MMMM d, yyyy h:mm a');
}

function formatCurrency(amount) {
  var value = isFinite(amount) ? amount : 0;
  var formatted = value.toFixed(2);
  var parts = formatted.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return '$' + parts.join('.');
}

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
