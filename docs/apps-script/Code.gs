/**
 * Budget Management Portal — Chart of Accounts JSON proxy + submission
 * backend.
 *
 * Paste this entire file into the Apps Script editor of a script bound to
 * your Chart of Accounts spreadsheet (Extensions -> Apps Script). It reads
 * the COA tabs for the website's dropdowns (doGet) and, separately, receives
 * completed submissions from BOTH portal workflows through the same
 * deployment (doPost): the Budget Transfer / Amendment Request and the
 * Fiscal Year Rollforward Request. doPost branches on the payload's
 * `requestType` field ('rollforward', or anything else treated as a
 * Transfer submission for backward compatibility) — see
 * handleTransferSubmission()/handleRollforwardSubmission() below. Each
 * generates its own PDF, records its own request in its own worksheet(s),
 * and emails the PDF to Budget Office staff. PDFs are never saved anywhere
 * (no Google Drive) — each exists only in memory for as long as it takes to
 * attach it to that outgoing email.
 *
 * Expected tabs and exact header row text:
 *
 *   "COA Departments"          Department Code | Department Name
 *   "COA Expenses"             Department Code | Expense Object | Expense Object Name | Project
 *   "COA Revenue"              Org Code | Object Code | Name  (Project, if present, is ignored)
 *   "Settings"                 Setting | Value  (see getSettings() below)
 *   "Budget Transfer Requests" one row per submitted Transfer request (see appendRequestRow())
 *   "Budget Transfer Lines"    one row per Transfer From/To line (see appendLineRows())
 *   "Rollforward Requests"     one row per account within a Rollforward request (see appendRollforwardRows())
 *
 * COA Expenses and COA Revenue don't carry a department *name* column, only
 * a code (Department Code / Org Code) — departmentName comes back blank for
 * those two, which is fine since only departmentCode is used for filtering.
 *
 * Some COA Expenses rows are already tied to a specific project number in
 * their Project column — that comes back as projectCode so the client can
 * search by it and auto-fill it once that account is selected.
 *
 * Notification recipients and the fiscal year are NOT hardcoded here —
 * they're read from the "Settings" sheet on every submission, so staff can
 * update them without touching this file. See getSettings(). Both Transfer
 * IDs ("2026-000001") and Rollforward IDs ("RF-2026-0001") number off the
 * same Settings!FiscalYear value but count rows in their own separate
 * sheets, so the two sequences never collide — see generateRequestId().
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
 * Handles a submitted request from either portal workflow.
 *
 * Input: e.postData.contents — a JSON string. For a Transfer submission,
 * matches the client's collectFormData() output (see js/app.js) plus
 * requestorEmail; for a Rollforward submission, matches js/rollforward.js's
 * collectFormData() output and carries requestType: 'rollforward'. The
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
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (requestData && requestData.requestType === 'rollforward') {
      return jsonResponse(handleRollforwardSubmission(ss, requestData));
    }
    return jsonResponse(handleTransferSubmission(ss, requestData));
  } catch (err) {
    // Full stack goes to the Apps Script execution log (Executions tab)
    // for troubleshooting; the client only sees a plain message.
    console.error('doPost failed: ' + (err && err.stack ? err.stack : err));
    return jsonResponse({ success: false, error: String(err && err.message ? err.message : err) });
  }
}

/**
 * Handles a Budget Transfer / Amendment Request submission. Behavior is
 * unchanged from before doPost supported multiple request types — only
 * moved into its own function so doPost can dispatch to it.
 *
 * Input: the spreadsheet, and the parsed request payload.
 * Output: { success: true, requestId } or { success: false, error }.
 */
function handleTransferSubmission(ss, requestData) {
  var validationErrors = validateSubmission(requestData);
  if (validationErrors.length > 0) {
    return { success: false, error: validationErrors.join(' ') };
  }

  var settings = getSettings(ss);
  var requestId = generateRequestId(ss, 'Budget Transfer Requests', settings.FiscalYear + '-', 6, 0);
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

  return { success: true, requestId: requestId };
}

/**
 * Handles a Fiscal Year Rollforward Request submission — the second portal
 * workflow, added alongside Transfer without touching any of its code. A
 * submission can carry one or more accounts (requestData.lines), each with
 * its own Expense Account, Amount, and Justification, all sharing one
 * Department/Requester/Fiscal Year. One row is written per line — like
 * Transfer's Budget Transfer Lines, but sharing "Rollforward Requests"
 * itself rather than a separate lines sheet, since every column there
 * already varies per line (Expense Account, Project Number, Amount,
 * Justification) except the columns that describe the whole request.
 *
 * Input: the spreadsheet, and the parsed request payload (see
 * js/rollforward.js's collectFormData()).
 * Output: { success: true, requestId } or { success: false, error }.
 */
function handleRollforwardSubmission(ss, requestData) {
  var validationErrors = validateRollforwardSubmission(requestData);
  if (validationErrors.length > 0) {
    return { success: false, error: validationErrors.join(' ') };
  }

  var settings = getSettings(ss);
  var requestId = generateRequestId(ss, 'Rollforward Requests', 'RF-' + settings.FiscalYear + '-', 4, 1);
  var timestamp = new Date();

  var lines = Array.isArray(requestData.lines) ? requestData.lines : [];
  var totalAmount = sumRollforwardLineAmounts(lines);

  var pdfBlob = buildRollforwardPdf(requestData, requestId, timestamp, lines, totalAmount);

  appendRollforwardRows(ss, {
    requestId: requestId,
    timestamp: timestamp,
    requestData: requestData,
    lines: lines,
  });

  sendRollforwardNotification(settings, requestData, requestId, timestamp, lines, totalAmount, pdfBlob);

  return { success: true, requestId: requestId };
}

function sumRollforwardLineAmounts(lines) {
  return lines.reduce(function (sum, line) {
    var amount = parseFloat(line && line.amount);
    return sum + (isFinite(amount) ? amount : 0);
  }, 0);
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
 * Generates the next sequential Request ID with a given prefix, counted
 * against a given sheet's Request ID column, e.g. ('Budget Transfer
 * Requests', '2026-', 6, 0) -> "2026-000042", or ('Rollforward Requests',
 * 'RF-2026-', 4, 1) -> "RF-2026-0042". Guarded by a script lock so two
 * submissions arriving at nearly the same moment can't both compute the
 * same next number. Transfer and Rollforward call this with different
 * sheet names, so their two numbering sequences can never collide with
 * each other.
 *
 * Input: the spreadsheet, the full ID prefix (already including the
 * fiscal year and any trailing "-"), how many digits to zero-pad the
 * sequence number to, and the 0-based column index the Request ID lives
 * in on that sheet (Transfer's sheet has it first; Rollforward's has
 * Timestamp first, per the user's specified column order).
 * Output: a string like "2026-000042" or "RF-2026-0042".
 */
function generateRequestId(ss, sheetName, idPrefix, padWidth, idColumnIndex) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      throw new Error('Sheet not found: "' + sheetName + '".');
    }

    var values = sheet.getDataRange().getValues();
    var count = 0;
    for (var i = 1; i < values.length; i += 1) {
      var existingId = String(values[i][idColumnIndex] || '');
      if (existingId.indexOf(idPrefix) === 0) {
        count += 1;
      }
    }

    var nextNumber = count + 1;
    var padded = String(nextNumber).padStart(padWidth, '0');
    return idPrefix + padded;
  } finally {
    lock.releaseLock();
  }
}

// ---------- Validation (server-side defense in depth) ----------

// Upper bound for any dollar amount, mirroring js/calculations.js's
// Calculations.MAX_AMOUNT — both client and server enforce the same
// ceiling. Field length caps below mirror the maxlength attributes in
// transfer.html/rollforward.html; re-checked here since a request could
// reach doPost without going through the browser's own maxlength
// enforcement.
var MAX_AMOUNT = 99999999.99;

function isValidAmountValue(value) {
  var amount = parseFloat(value);
  return isFinite(amount) && amount > 0 && amount <= MAX_AMOUNT;
}

function isValidLength(value, maxLength) {
  return String(value || '').length <= maxLength;
}

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
  if (!data.description) {
    errors.push('Description is required.');
  } else if (!isValidLength(data.description, 250)) {
    errors.push('Description must be 250 characters or fewer.');
  }
  if (!data.preparedBy) {
    errors.push('Prepared By is required.');
  } else if (!isValidLength(data.preparedBy, 50)) {
    errors.push('Prepared By must be 50 characters or fewer.');
  }
  if (!data.title) {
    errors.push('Title is required.');
  } else if (!isValidLength(data.title, 50)) {
    errors.push('Title must be 50 characters or fewer.');
  }
  if (!data.requestorEmail || !isValidEmailFormat(data.requestorEmail)) {
    errors.push('A valid Requestor Email Address is required.');
  } else if (!isValidLength(data.requestorEmail, 50)) {
    errors.push('Requestor Email Address must be 50 characters or fewer.');
  }
  if (!data.amendmentType || !AMENDMENT_TYPE_LABELS[data.amendmentType]) {
    errors.push('A valid amendment type is required.');
  }

  var fromLines = Array.isArray(data.transferFrom) ? data.transferFrom.filter(hasAccount) : [];
  var toLines = Array.isArray(data.transferTo) ? data.transferTo.filter(hasAccount) : [];

  if (fromLines.length === 0) errors.push('At least one Transfer From account is required.');
  if (toLines.length === 0) errors.push('At least one Transfer To account is required.');

  var hasInvalidAmount = fromLines.concat(toLines).some(function (line) {
    return !isValidAmountValue(line.amount);
  });
  if (hasInvalidAmount) {
    errors.push('Each transfer amount must be between 0.01 and ' + formatCurrency(MAX_AMOUNT) + '.');
  }

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

/**
 * Re-validates a Rollforward submission server-side — mirrors
 * validateSubmission()'s style/purpose for the Transfer workflow. A
 * submission carries one or more lines (data.lines), each needing its own
 * Expense Account, Amount, and Justification; Department/Requester/Fiscal
 * Year/Certification apply to the whole submission.
 *
 * Input: the parsed request payload.
 * Output: an array of human-readable error strings (empty = valid).
 */
function validateRollforwardSubmission(data) {
  var errors = [];

  if (!data || typeof data !== 'object') {
    return ['Malformed request payload.'];
  }
  if (!data.requesterName) {
    errors.push('Requester Name is required.');
  } else if (!isValidLength(data.requesterName, 50)) {
    errors.push('Requester Name must be 50 characters or fewer.');
  }
  if (!data.requesterEmail || !isValidEmailFormat(data.requesterEmail)) {
    errors.push('A valid Requester Email is required.');
  } else if (!isValidLength(data.requesterEmail, 50)) {
    errors.push('Requester Email must be 50 characters or fewer.');
  }
  if (!data.department || !data.department.code) errors.push('Department is required.');
  if (!data.fiscalYear) errors.push('Fiscal Year is required.');
  if (data.certified !== true) errors.push('Certification is required.');

  var lines = Array.isArray(data.lines) ? data.lines : [];
  if (lines.length === 0) {
    errors.push('At least one account to roll forward is required.');
  }
  lines.forEach(function (line, index) {
    var label = 'Rollforward Request #' + (index + 1) + ': ';
    if (!line || !line.account || !line.account.code) {
      errors.push(label + 'an Expense Account is required.');
    }
    if (!line || !isValidAmountValue(line.amount)) {
      errors.push(label + 'a valid Amount between 0.01 and ' + formatCurrency(MAX_AMOUNT) + ' is required.');
    }
    if (!line || !line.justification) {
      errors.push(label + 'a Detailed Justification is required.');
    } else if (!isValidLength(line.justification, 250)) {
      errors.push(label + 'Detailed Justification must be 250 characters or fewer.');
    }
    // Contract or PO Number is optional (alphanumeric) — only its length is checked.
    if (line && line.contractPoNumber && !isValidLength(line.contractPoNumber, 50)) {
      errors.push(label + 'Contract or PO Number must be 50 characters or fewer.');
    }
  });

  return errors;
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

/**
 * Appends one row per line to "Rollforward Requests" — a request with 3
 * accounts writes 3 rows, all sharing the same Request ID/Timestamp/
 * Requester/Department/Fiscal Year, exactly like Transfer's "Budget
 * Transfer Lines" sheet shares one Request ID across multiple lines. No
 * rollback/pairing logic is needed here (unlike Transfer's two-sheet
 * write) since it's a single batched write to one sheet.
 * Columns, in order: Timestamp, Request ID, Requester Name, Requester
 * Email, Department Code, Department Name, Expense Account, Project
 * Number, Contract or PO Number, Amount, Fiscal Year, Justification,
 * Status, Submitted By.
 *
 * "Submitted By" is populated with the same Requester Name — this form
 * has no separate submitter identity from the requester.
 */
function appendRollforwardRows(ss, params) {
  var sheet = ss.getSheetByName('Rollforward Requests');
  if (!sheet) {
    throw new Error('Sheet not found: "Rollforward Requests".');
  }
  if (params.lines.length === 0) return;

  var data = params.requestData;
  var department = data.department || {};

  var rows = params.lines.map(function (line) {
    var account = line.account || {};
    // Reuses the same composite-number builder Transfer's lines use, so an
    // Expense Account reads identically everywhere in the app.
    var accountNumber = buildAccountNumber(department.code, account, line.projectCode);

    return [
      params.timestamp,
      params.requestId,
      data.requesterName || '',
      data.requesterEmail || '',
      department.code || '',
      department.name || '',
      accountNumber + (account.name ? ' - ' + account.name : ''),
      line.projectCode || '',
      line.contractPoNumber || '',
      parseFloat(line.amount) || 0,
      data.fiscalYear || '',
      line.justification || '',
      'Submitted',
      data.requesterName || '',
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

  var css = buildPdfCss();

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

// Shared inline CSS for every generated PDF (Transfer's and Rollforward's)
// so both documents stay visually consistent without copy-pasted CSS.
function buildPdfCss() {
  return ''
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
    + '.total{text-align:right;font-weight:bold;margin-top:4px;font-size:10px;}'
    + '.justification{margin-top:6px;white-space:pre-wrap;}'
    + '.rf-line{border:1px solid #d6dbdc;border-radius:6px;padding:10px 12px;margin-top:10px;}'
    + '.rf-line h2{margin-top:0;}';
}

/**
 * Builds the Rollforward Request PDF blob, attached to the county
 * notification email. Mirrors buildRequestPdf()'s shape — a single blob,
 * never written to Drive, that exists only for the lifetime of this
 * request.
 */
function buildRollforwardPdf(data, requestId, timestamp, lines, totalAmount) {
  var html = buildRollforwardHtml(data, requestId, timestamp, lines, totalAmount);
  var htmlBlob = Utilities.newBlob(html, 'text/html', 'rollforward.html');
  var pdfBlob = htmlBlob.getAs('application/pdf');
  pdfBlob.setName('Rollforward-Request-' + requestId + '.pdf');
  return pdfBlob;
}

// A shared header block (requester/department/fiscal year) followed by one
// bordered block per line — each with its own Expense Account, Amount, and
// Justification — plus a grand total. Simpler than Transfer's side-by-side
// Transfer From/To tables since Justification needs full-width room to
// read, not a narrow table column.
function buildRollforwardHtml(data, requestId, timestamp, lines, totalAmount) {
  var department = data.department || {};
  var css = buildPdfCss();

  var linesHtml = lines.map(function (line, index) {
    var account = line.account || {};
    var accountNumber = buildAccountNumber(department.code, account, line.projectCode);
    var amount = parseFloat(line.amount) || 0;

    return '<div class="rf-line">'
      + '<h2>Rollforward Request #' + (index + 1) + '</h2>'
      + '<div class="meta"><b>Expense Account:</b> ' + escapeHtml(accountNumber)
        + (account.name ? ' - ' + escapeHtml(account.name) : '') + '</div>'
      + (line.projectCode ? '<div class="meta"><b>Project Number:</b> ' + escapeHtml(line.projectCode) + '</div>' : '')
      + (line.contractPoNumber ? '<div class="meta"><b>Contract or PO Number:</b> ' + escapeHtml(line.contractPoNumber) + '</div>' : '')
      + '<div class="meta"><b>Amount:</b> ' + formatCurrency(amount) + '</div>'
      + '<div class="meta"><b>Justification:</b></div>'
      + '<div class="justification">' + escapeHtml(line.justification || '') + '</div>'
      + '</div>';
  }).join('');

  return '<html><head><meta charset="UTF-8"><style>' + css + '</style></head><body>'
    + '<h1>Fiscal Year Rollforward Request</h1>'
    + '<div class="meta"><b>Request ID:</b> ' + escapeHtml(requestId) + '</div>'
    + '<div class="meta"><b>Date:</b> ' + escapeHtml(formatTimestampForEmail(timestamp)) + '</div>'
    + '<div class="meta"><b>Requester Name:</b> ' + escapeHtml(data.requesterName || '')
      + '&nbsp;&nbsp;&nbsp;<b>Requester Email:</b> ' + escapeHtml(data.requesterEmail || '') + '</div>'
    + '<div class="meta"><b>Department:</b> ' + escapeHtml(formatDepartmentForDisplay(department)) + '</div>'
    + '<div class="meta"><b>Fiscal Year:</b> ' + escapeHtml(data.fiscalYear || '') + '</div>'
    + linesHtml
    + '<div class="total">Total Amount Requested to Roll Forward: ' + formatCurrency(totalAmount) + '</div>'
    + '</body></html>';
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

/**
 * Emails the submitted Rollforward request's PDF to every address in
 * Settings!NotificationEmails — mirrors sendCountyNotification()'s shape.
 * Only the county notification sends; the requester is not emailed,
 * matching how Transfer submissions currently work. The email body
 * summarizes the request (account count, total); per-account amounts and
 * justifications are in the attached PDF.
 */
function sendRollforwardNotification(settings, data, requestId, timestamp, lines, totalAmount, pdfBlob) {
  if (settings.NotificationEmails.length === 0) return;

  var department = data.department || {};

  var body = 'A Fiscal Year Rollforward Request has been submitted.\n\n'
    + 'Request ID:\n' + requestId + '\n\n'
    + 'Department:\n' + (department.name || '—') + '\n\n'
    + 'Number of Accounts:\n' + lines.length + '\n\n'
    + 'Total Amount Requested to Roll Forward:\n' + formatCurrency(totalAmount) + '\n\n'
    + 'Fiscal Year:\n' + (data.fiscalYear || '') + '\n\n'
    + 'Requester:\n' + (data.requesterName || '') + '\n\n'
    + 'Requester Email:\n' + (data.requesterEmail || '') + '\n\n'
    + 'Submission Date:\n' + formatTimestampForEmail(timestamp) + '\n\n'
    + 'See the attached PDF for the account-by-account amounts and justifications.';

  MailApp.sendEmail({
    to: settings.NotificationEmails.join(','),
    subject: 'Fiscal Year Rollforward Request Submitted – Request #' + requestId,
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
