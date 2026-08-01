/**
 * Budget Management Portal — Chart of Accounts JSON proxy + submission
 * backend.
 *
 * Paste this entire file into the Apps Script editor of a script bound to
 * your Chart of Accounts spreadsheet (Extensions -> Apps Script). It reads
 * the COA tabs for the website's dropdowns (doGet) and, separately, receives
 * completed submissions from ALL THREE portal workflows through the same
 * deployment (doPost): the Budget Request, the Grant Amendment Request,
 * and the Rollforward Request. doPost branches on the payload's
 * `requestType` field ('grant', 'rollforward', or anything else treated
 * as a Budget Request submission for backward compatibility) — see
 * handleTransferSubmission()/handleGrantSubmission()/
 * handleRollforwardSubmission() below. Each generates its own PDF,
 * records its own request in its own worksheet(s), and emails the PDF to
 * Budget Office staff. PDFs are never saved anywhere (no Google Drive) —
 * each exists only in memory for as long as it takes to attach it to that
 * outgoing email.
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
 *   "Grant Amendment Requests" one row per submitted Grant Amendment request (see appendGrantRequestRow())
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

// Grant Amendment Request category -> expense object code. Mirrors
// js/grant.js's CATEGORY_OBJECT_CODES.
var GRANT_CATEGORY_OBJECT_CODES = {
  equipment: '564000',
  construction: '563000',
  design: '531000',
  salaries: '512000',
  other: '534000',
};

// Grant Amendment Request source -> Florida Accounting Manual revenue
// series (331 Federal Grants, 334 State Grants). Mirrors js/grant.js's
// GRANT_TYPE_CODES.
var GRANT_TYPE_CODES = {
  federal: '331',
  state: '334',
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
    if (requestData && requestData.requestType === 'grant') {
      return jsonResponse(handleGrantSubmission(ss, requestData));
    }
    if (requestData && requestData.requestType === 'budgetRequest') {
      return jsonResponse(handleBudgetRequestSubmission(ss, requestData));
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
 * Handles a Transfer Request submission (the portal's original workflow,
 * titled "Budget Request" before the Budget Request/Transfer Request
 * split — see handleBudgetRequestSubmission() for the newer, separate
 * "funding for next fiscal year" workflow). Behavior is unchanged from
 * before doPost supported multiple request types — only moved into its
 * own function so doPost can dispatch to it.
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
 * Handles a Rollforward Request submission — the second portal
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

/**
 * Handles a Budget Request submission — the fourth portal workflow, and
 * the portal's richest: a department's full funding request for next
 * fiscal year, covering New Staffing Requests, Current Vacancies,
 * Operations, Contractual Services, and Capital Requests (New Vehicle /
 * Replacement Vehicle / Equipment / Infrastructure). Every section is
 * optional — a request just needs at least one line somewhere (enforced
 * client-side; re-checked here in validateBudgetRequestSubmission()).
 *
 * Input: the spreadsheet, and the parsed request payload (see
 * js/budgetRequest.js's collectFormData()) — requestData.newStaffing,
 * .vacancies, .operations, .contractualServices, and .capital are each
 * an array (any of which may be empty).
 * Output: { success: true, requestId } or { success: false, error }.
 */
function handleBudgetRequestSubmission(ss, requestData) {
  var validationErrors = validateBudgetRequestSubmission(requestData);
  if (validationErrors.length > 0) {
    return { success: false, error: validationErrors.join(' ') };
  }

  var settings = getSettings(ss);
  var requestId = generateRequestId(ss, 'Budget Requests', 'BR-' + settings.FiscalYear + '-', 4, 0);
  var timestamp = new Date();

  var newStaffing = Array.isArray(requestData.newStaffing) ? requestData.newStaffing : [];
  var vacancies = Array.isArray(requestData.vacancies) ? requestData.vacancies : [];
  var operations = Array.isArray(requestData.operations) ? requestData.operations : [];
  var contractualServices = Array.isArray(requestData.contractualServices) ? requestData.contractualServices : [];
  var capital = Array.isArray(requestData.capital) ? requestData.capital : [];

  var totals = {
    newStaffing: newStaffing.reduce(function (sum, line) { return sum + (parseFloat(line.estimatedAnnualCost) || 0); }, 0),
    operations: sumRollforwardLineAmounts(operations),
    contractualServices: sumRollforwardLineAmounts(contractualServices),
    capital: capital.reduce(function (sum, line) { return sum + (parseFloat(line.totalCost) || 0); }, 0),
  };
  totals.grand = totals.newStaffing + totals.operations + totals.contractualServices + totals.capital;

  var sections = {
    newStaffing: newStaffing,
    vacancies: vacancies,
    operations: operations,
    contractualServices: contractualServices,
    capital: capital,
  };

  var pdfBlob = buildBudgetRequestPdf(requestData, requestId, timestamp, sections, totals);

  appendBudgetRequestRows(ss, {
    requestId: requestId,
    timestamp: timestamp,
    requestData: requestData,
    sections: sections,
    totals: totals,
  });

  sendBudgetRequestNotification(settings, requestData, requestId, timestamp, sections, totals, pdfBlob);

  return { success: true, requestId: requestId };
}

/**
 * Handles a Grant Amendment Request submission — the third portal
 * workflow. Unlike Transfer/Rollforward, the Revenue and Expense
 * accounts are never searched from the Chart of Accounts; they're
 * computed here from Grant Source + Activity + Department + Category
 * (see buildGrantAccountNumbers()), independent of whatever account
 * number strings the client may have sent — same "server recomputes,
 * never trusts a client-built composite" principle buildTransferLines()
 * already follows for Transfer.
 *
 * Input: the spreadsheet, and the parsed request payload (see
 * js/grant.js's collectFormData()).
 * Output: { success: true, requestId } or { success: false, error }.
 */
function handleGrantSubmission(ss, requestData) {
  var validationErrors = validateGrantSubmission(requestData);
  if (validationErrors.length > 0) {
    return { success: false, error: validationErrors.join(' ') };
  }

  var settings = getSettings(ss);
  var requestId = generateRequestId(ss, 'Grant Amendment Requests', 'GR-' + settings.FiscalYear + '-', 4, 0);
  var timestamp = new Date();
  var amount = parseFloat(requestData.amount) || 0;
  var accounts = buildGrantAccountNumbers(requestData);

  var pdfBlob = buildGrantPdf(requestData, requestId, timestamp, accounts, amount);

  appendGrantRequestRow(ss, {
    requestId: requestId,
    timestamp: timestamp,
    requestData: requestData,
    accounts: accounts,
    amount: amount,
  });

  sendGrantNotification(settings, requestData, requestId, timestamp, accounts, amount, pdfBlob);

  return { success: true, requestId: requestId };
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
  if (!data.date) errors.push('Date is required.');
  if (!data.requesterName) {
    errors.push('Requester Name is required.');
  } else if (!isValidLength(data.requesterName, 50)) {
    errors.push('Requester Name must be 50 characters or fewer.');
  }
  if (!data.title) {
    errors.push('Title is required.');
  } else if (!isValidLength(data.title, 50)) {
    errors.push('Title must be 50 characters or fewer.');
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

/**
 * Re-validates a Budget Request submission server-side. Structurally
 * this covers five independent sections (each an array on `data`, any
 * of which may be empty) rather than Rollforward's single `lines`
 * array — a department might submit only a Capital request this year,
 * so the only cross-section rule is "at least one line somewhere",
 * not "at least one line in every section".
 *
 * Input: the parsed request payload.
 * Output: an array of human-readable error strings (empty = valid).
 */
function validateBudgetRequestSubmission(data) {
  var errors = [];

  if (!data || typeof data !== 'object') {
    return ['Malformed request payload.'];
  }
  if (!data.date) errors.push('Date is required.');
  if (!data.requesterName) {
    errors.push('Requester Name is required.');
  } else if (!isValidLength(data.requesterName, 50)) {
    errors.push('Requester Name must be 50 characters or fewer.');
  }
  if (!data.title) {
    errors.push('Title is required.');
  } else if (!isValidLength(data.title, 50)) {
    errors.push('Title must be 50 characters or fewer.');
  }
  if (!data.requesterEmail || !isValidEmailFormat(data.requesterEmail)) {
    errors.push('A valid Requester Email is required.');
  } else if (!isValidLength(data.requesterEmail, 50)) {
    errors.push('Requester Email must be 50 characters or fewer.');
  }
  if (!data.department || !data.department.code) errors.push('Department is required.');
  if (!data.fiscalYear) errors.push('Fiscal Year is required.');
  if (data.certified !== true) errors.push('Certification is required.');

  var newStaffing = Array.isArray(data.newStaffing) ? data.newStaffing : [];
  var vacancies = Array.isArray(data.vacancies) ? data.vacancies : [];
  var operations = Array.isArray(data.operations) ? data.operations : [];
  var contractualServices = Array.isArray(data.contractualServices) ? data.contractualServices : [];
  var capital = Array.isArray(data.capital) ? data.capital : [];

  var totalLineCount = newStaffing.length + vacancies.length + operations.length
    + contractualServices.length + capital.length;
  if (totalLineCount === 0) {
    errors.push('At least one item is required in at least one section (New Staffing, Vacancies, Operations, Contractual Services, or Capital).');
  }

  newStaffing.forEach(function (line, index) {
    var label = 'New Position Request ' + (index + 1) + ': ';
    if (!line || !line.positionTitle) errors.push(label + 'a Position Title is required.');
    if (!line || !(parseInt(line.numberOfPositions, 10) >= 1)) errors.push(label + 'Number of Positions must be at least 1.');
    if (!line || !isValidAmountValue(line.estimatedAnnualCost)) {
      errors.push(label + 'a valid Estimated Annual Cost between 0.01 and ' + formatCurrency(MAX_AMOUNT) + ' is required.');
    }
    if (!line || !line.justification) {
      errors.push(label + 'a Justification is required.');
    } else if (!isValidLength(line.justification, 250)) {
      errors.push(label + 'Justification must be 250 characters or fewer.');
    }
  });

  vacancies.forEach(function (line, index) {
    var label = 'Vacant Position ' + (index + 1) + ': ';
    if (!line || !line.positionTitle) errors.push(label + 'a Position Title is required.');
    if (!line || !line.vacantSince) errors.push(label + 'Vacant Since is required.');
  });

  function validateAccountLine(line, index, label) {
    if (!line || !line.account || !line.account.code) {
      errors.push(label + 'an Expense Account is required.');
    }
    if (!line || !isValidAmountValue(line.amount)) {
      errors.push(label + 'a valid Requested Amount between 0.01 and ' + formatCurrency(MAX_AMOUNT) + ' is required.');
    }
    if (!line || !line.justification) {
      errors.push(label + 'a Justification is required.');
    } else if (!isValidLength(line.justification, 250)) {
      errors.push(label + 'Justification must be 250 characters or fewer.');
    }
    // Current FY Budget is optional (for reference only) — only checked
    // for a valid amount if the requester filled it in at all.
    if (line && line.currentFiscalYearBudget && !isValidAmountValue(line.currentFiscalYearBudget)) {
      errors.push(label + 'Current FY Budget must be a valid amount if provided.');
    }
  }

  operations.forEach(function (line, index) {
    validateAccountLine(line, index, 'Operating Line Item ' + (index + 1) + ': ');
  });
  contractualServices.forEach(function (line, index) {
    validateAccountLine(line, index, 'Contractual Service ' + (index + 1) + ': ');
  });

  var VALID_CAPITAL_TYPES = { 'New Vehicle': true, 'Replacement Vehicle': true, 'Equipment': true, 'Infrastructure': true };
  capital.forEach(function (line, index) {
    var label = 'Capital Item ' + (index + 1) + ': ';
    if (!line || !VALID_CAPITAL_TYPES[line.type]) {
      errors.push(label + 'a valid Type (New Vehicle, Replacement Vehicle, Equipment, or Infrastructure) is required.');
    }
    if (!line || !line.description) {
      errors.push(label + 'a Description is required.');
    } else if (!isValidLength(line.description, 120)) {
      errors.push(label + 'Description must be 120 characters or fewer.');
    }
    if (!line || !(parseInt(line.quantity, 10) >= 1)) errors.push(label + 'Quantity must be at least 1.');
    if (!line || !isValidAmountValue(line.unitCost)) {
      errors.push(label + 'a valid Estimated Unit Cost between 0.01 and ' + formatCurrency(MAX_AMOUNT) + ' is required.');
    }
    if (!line || !line.justification) {
      errors.push(label + 'a Justification is required.');
    } else if (!isValidLength(line.justification, 250)) {
      errors.push(label + 'Justification must be 250 characters or fewer.');
    }
  });

  return errors;
}

/**
 * Re-validates a Grant Amendment submission server-side — mirrors
 * validateSubmission()/validateRollforwardSubmission()'s style/purpose.
 *
 * Input: the parsed request payload.
 * Output: an array of human-readable error strings (empty = valid).
 */
function validateGrantSubmission(data) {
  var errors = [];

  if (!data || typeof data !== 'object') {
    return ['Malformed request payload.'];
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
  if (!data.grantSource || !GRANT_TYPE_CODES[data.grantSource]) {
    errors.push('A valid Grant Source (Federal or State) is required.');
  }
  if (!data.activityCode || !/^[0-9]{3}$/.test(data.activityCode)) {
    errors.push('A valid grant Activity is required.');
  }
  if (!data.grantingAgency) {
    errors.push('Granting Agency is required.');
  } else if (!isValidLength(data.grantingAgency, 120)) {
    errors.push('Granting Agency must be 120 characters or fewer.');
  }
  if (!data.grantProgramName) {
    errors.push('Grant Program Name is required.');
  } else if (!isValidLength(data.grantProgramName, 150)) {
    errors.push('Grant Program Name must be 150 characters or fewer.');
  }
  if (!data.boardApprovalDate) {
    errors.push('The date the Board will approve the grant agreement is required.');
  }
  if (!data.department || !data.department.code) errors.push('Department is required.');
  if (!data.category || !GRANT_CATEGORY_OBJECT_CODES[data.category]) {
    errors.push('A valid amendment Category (Equipment, Construction, Design, Salaries, or Other) is required.');
  }
  if (!isValidAmountValue(data.amount)) {
    errors.push('A valid Amount between 0.01 and ' + formatCurrency(MAX_AMOUNT) + ' is required.');
  }
  if (data.grantNumber && !/^[0-9]{5}$/.test(data.grantNumber)) {
    errors.push('Grant Number must be a 5-digit number.');
  }

  return errors;
}

// ---------- Grant Amendment accounts (shared by the Sheets writer and the PDF) ----------

/**
 * Computes the Revenue and Expense account numbers for a Grant Amendment
 * Request from Grant Source + Activity + Department + Category —
 * recomputed here from the raw inputs rather than trusting any
 * account-number string the client may have sent, same principle
 * buildTransferLines() follows for Transfer. Mirrors js/grant.js's
 * buildRevenueAccountNumber()/buildExpenseAccountNumber() exactly.
 *
 * Output: { revenueAccountNumber, expenseAccountNumber } — either may be
 * an empty string if the inputs needed to build it are missing/invalid
 * (validateGrantSubmission() should already have rejected that case).
 */
function buildGrantAccountNumbers(data) {
  var department = data.department || {};
  var grantNumber = data.grantNumber || '';

  var typeCode = GRANT_TYPE_CODES[data.grantSource];
  var revenueAccountNumber = '';
  if (typeCode && data.activityCode && department.code) {
    var fund = String(department.code).slice(0, 3);
    var revenueDeptCode = fund + typeCode;
    var revenueObjectCode = typeCode + data.activityCode;
    revenueAccountNumber = [revenueDeptCode, revenueObjectCode, grantNumber].filter(Boolean).join('-');
  }

  var objectCode = GRANT_CATEGORY_OBJECT_CODES[data.category];
  var expenseAccountNumber = '';
  if (objectCode && department.code) {
    expenseAccountNumber = [department.code, objectCode, grantNumber].filter(Boolean).join('-');
  }

  return { revenueAccountNumber: revenueAccountNumber, expenseAccountNumber: expenseAccountNumber };
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
 * Status, Submitted By, Request Date, Title.
 *
 * "Submitted By" is populated with the same Requester Name — this form
 * has no separate submitter identity from the requester. Request Date and
 * Title are appended at the end (rather than inline near Requester Name)
 * so an existing "Rollforward Requests" sheet only needs two new trailing
 * columns added, not a full reorder.
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
      data.date || '',
      data.title || '',
    ];
  });

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

/**
 * Writes a Budget Request submission across its five sheets: one
 * summary row in "Budget Requests", plus one row per line in each of
 * "Budget Request Staffing", "Budget Request Vacancies", "Budget
 * Request Line Items" (Operations and Contractual Services share this
 * sheet, told apart by its Category column), and "Budget Request
 * Capital". Any section with zero lines simply writes zero rows to its
 * sheet — there's no rollback/pairing concern here (unlike Transfer's
 * two-sheet write) since every sheet's write is independent and a
 * missing section is a normal, expected state.
 *
 * "Budget Requests" columns, in order: Request ID, Timestamp,
 * Requester Name, Requester Email, Department Code, Department Name,
 * Fiscal Year, Request Date, Title, Total New Staffing Cost, Total
 * Operations, Total Contractual Services, Total Capital, Grand Total,
 * Status.
 */
function appendBudgetRequestRows(ss, params) {
  var data = params.requestData;
  var department = data.department || {};
  var totals = params.totals;

  var summarySheet = ss.getSheetByName('Budget Requests');
  if (!summarySheet) {
    throw new Error('Sheet not found: "Budget Requests".');
  }
  summarySheet.appendRow([
    params.requestId,
    params.timestamp,
    data.requesterName || '',
    data.requesterEmail || '',
    department.code || '',
    department.name || '',
    data.fiscalYear || '',
    data.date || '',
    data.title || '',
    totals.newStaffing,
    totals.operations,
    totals.contractualServices,
    totals.capital,
    totals.grand,
    'Submitted',
  ]);

  appendBudgetRequestStaffingRows(ss, params);
  appendBudgetRequestVacancyRows(ss, params);
  appendBudgetRequestLineItemRows(ss, params);
  appendBudgetRequestCapitalRows(ss, params);
}

/**
 * Appends one row per new position to "Budget Request Staffing".
 * Columns, in order: Request ID, Timestamp, Position Title, Number of
 * Positions, Estimated Annual Cost, Justification.
 */
function appendBudgetRequestStaffingRows(ss, params) {
  var lines = params.sections.newStaffing;
  if (lines.length === 0) return;

  var sheet = ss.getSheetByName('Budget Request Staffing');
  if (!sheet) {
    throw new Error('Sheet not found: "Budget Request Staffing".');
  }

  var rows = lines.map(function (line) {
    return [
      params.requestId,
      params.timestamp,
      line.positionTitle || '',
      parseInt(line.numberOfPositions, 10) || 0,
      parseFloat(line.estimatedAnnualCost) || 0,
      line.justification || '',
    ];
  });

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

/**
 * Appends one row per vacant position to "Budget Request Vacancies".
 * No dollar figure — these are already-budgeted positions, not a new
 * funding request; Time Vacant is stored as the client computed it
 * (a human-readable string like "1 year, 2 months") rather than
 * recomputed server-side, since it's informational, not validated.
 * Columns, in order: Request ID, Timestamp, Position Title, Position
 * Number, Vacant Since, Time Vacant, Plan to Fill, Notes.
 */
function appendBudgetRequestVacancyRows(ss, params) {
  var lines = params.sections.vacancies;
  if (lines.length === 0) return;

  var sheet = ss.getSheetByName('Budget Request Vacancies');
  if (!sheet) {
    throw new Error('Sheet not found: "Budget Request Vacancies".');
  }

  var rows = lines.map(function (line) {
    return [
      params.requestId,
      params.timestamp,
      line.positionTitle || '',
      line.positionNumber || '',
      line.vacantSince || '',
      line.timeVacant || '',
      line.planToFill || '',
      line.notes || '',
    ];
  });

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

/**
 * Appends one row per line to "Budget Request Line Items" — Operations
 * and Contractual Services share this sheet (told apart by Category)
 * since both are Expense-Account-driven with the same Current FY
 * Budget / Requested Amount / Justification shape; only Contractual
 * Services populates Vendor Name.
 * Columns, in order: Request ID, Timestamp, Category, Vendor Name,
 * Expense Account, Project Number, Current FY Budget, Requested
 * Amount, Justification.
 */
function appendBudgetRequestLineItemRows(ss, params) {
  var data = params.requestData;
  var department = data.department || {};
  var operations = params.sections.operations;
  var contractualServices = params.sections.contractualServices;
  if (operations.length === 0 && contractualServices.length === 0) return;

  var sheet = ss.getSheetByName('Budget Request Line Items');
  if (!sheet) {
    throw new Error('Sheet not found: "Budget Request Line Items".');
  }

  function buildRow(line, category) {
    var account = line.account || {};
    var accountNumber = buildAccountNumber(department.code, account, line.projectCode);
    return [
      params.requestId,
      params.timestamp,
      category,
      line.vendorName || '',
      accountNumber + (account.name ? ' - ' + account.name : ''),
      line.projectCode || '',
      line.currentFiscalYearBudget ? (parseFloat(line.currentFiscalYearBudget) || 0) : '',
      parseFloat(line.amount) || 0,
      line.justification || '',
    ];
  }

  var rows = operations.map(function (line) { return buildRow(line, 'Operations'); })
    .concat(contractualServices.map(function (line) { return buildRow(line, 'Contractual Services'); }));

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

/**
 * Appends one row per item to "Budget Request Capital".
 * Columns, in order: Request ID, Timestamp, Type, Description,
 * Quantity, Estimated Unit Cost, Total Estimated Cost, Justification.
 */
function appendBudgetRequestCapitalRows(ss, params) {
  var lines = params.sections.capital;
  if (lines.length === 0) return;

  var sheet = ss.getSheetByName('Budget Request Capital');
  if (!sheet) {
    throw new Error('Sheet not found: "Budget Request Capital".');
  }

  var rows = lines.map(function (line) {
    return [
      params.requestId,
      params.timestamp,
      line.type || '',
      line.description || '',
      parseInt(line.quantity, 10) || 0,
      parseFloat(line.unitCost) || 0,
      parseFloat(line.totalCost) || 0,
      line.justification || '',
    ];
  });

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

/**
 * Appends one row to "Grant Amendment Requests" — one row per request
 * (unlike Rollforward, a Grant Amendment always has exactly one Revenue
 * line and one Expense line, so both fit on the same row instead of
 * needing a separate lines sheet).
 * Columns, in order: Request ID, Timestamp, Prepared By, Title,
 * Requestor Email, Grant Source, Activity Code, Activity Label,
 * Department Code, Department Name, Category, Revenue Account, Expense
 * Account, Amount, Grant Number, Status, Granting Agency, Grant Program
 * Name, Board Approval Date.
 */
function appendGrantRequestRow(ss, params) {
  var sheet = ss.getSheetByName('Grant Amendment Requests');
  if (!sheet) {
    throw new Error('Sheet not found: "Grant Amendment Requests".');
  }

  var data = params.requestData;
  var department = data.department || {};
  var accounts = params.accounts;

  sheet.appendRow([
    params.requestId,
    params.timestamp,
    data.preparedBy || '',
    data.title || '',
    data.requestorEmail || '',
    data.grantSource === 'federal' ? 'Federal' : 'State',
    data.activityCode || '',
    data.activityLabel || '',
    department.code || '',
    department.name || '',
    data.category || '',
    accounts.revenueAccountNumber,
    accounts.expenseAccountNumber,
    params.amount,
    data.grantNumber || '',
    'Submitted',
    data.grantingAgency || '',
    data.grantProgramName || '',
    data.boardApprovalDate || '',
  ]);
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
    + '<h1>Budget Request</h1>'
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
    + '<h1>Rollforward Request</h1>'
    + '<div class="meta"><b>Request ID:</b> ' + escapeHtml(requestId) + '</div>'
    + '<div class="meta"><b>Date:</b> ' + escapeHtml(formatDateForDisplay(data.date))
      + '&nbsp;&nbsp;&nbsp;<b>Requester Name:</b> ' + escapeHtml(data.requesterName || '')
      + '&nbsp;&nbsp;&nbsp;<b>Title:</b> ' + escapeHtml(data.title || '') + '</div>'
    + '<div class="meta"><b>Requester Email:</b> ' + escapeHtml(data.requesterEmail || '') + '</div>'
    + '<div class="meta"><b>Department:</b> ' + escapeHtml(formatDepartmentForDisplay(department)) + '</div>'
    + '<div class="meta"><b>Fiscal Year:</b> ' + escapeHtml(data.fiscalYear || '') + '</div>'
    + linesHtml
    + '<div class="total">Total Amount Requested to Roll Forward: ' + formatCurrency(totalAmount) + '</div>'
    + '</body></html>';
}

/**
 * Builds the Budget Request PDF blob, attached to the county
 * notification email.
 */
function buildBudgetRequestPdf(data, requestId, timestamp, sections, totals) {
  var html = buildBudgetRequestHtml(data, requestId, timestamp, sections, totals);
  var htmlBlob = Utilities.newBlob(html, 'text/html', 'budget-request.html');
  var pdfBlob = htmlBlob.getAs('application/pdf');
  pdfBlob.setName('Budget-Request-' + requestId + '.pdf');
  return pdfBlob;
}

// A shared header block (requester/department/fiscal year) followed by one
// heading + set of bordered blocks per non-empty section (New Staffing,
// Vacancies, Operations, Contractual Services, Capital), plus a grand
// total. Any section with zero lines is skipped entirely rather than
// printing an empty heading.
function buildBudgetRequestHtml(data, requestId, timestamp, sections, totals) {
  var department = data.department || {};
  var css = buildPdfCss();

  function metaRow(label, value) {
    return '<div class="meta"><b>' + escapeHtml(label) + ':</b> ' + escapeHtml(String(value)) + '</div>';
  }

  function section(heading, lines, buildBlock) {
    if (lines.length === 0) return '';
    return '<h2>' + escapeHtml(heading) + '</h2>' + lines.map(buildBlock).join('');
  }

  var newStaffingHtml = section('New Staffing Requests', sections.newStaffing, function (line, index) {
    return '<div class="rf-line">'
      + '<h3>New Position Request ' + (index + 1) + '</h3>'
      + metaRow('Position Title', line.positionTitle || '—')
      + metaRow('Number of Positions', line.numberOfPositions || '—')
      + metaRow('Estimated Annual Cost', formatCurrency(parseFloat(line.estimatedAnnualCost) || 0))
      + '<div class="meta"><b>Justification:</b></div>'
      + '<div class="justification">' + escapeHtml(line.justification || '') + '</div>'
      + '</div>';
  });

  var vacanciesHtml = section('Current Vacancies', sections.vacancies, function (line, index) {
    return '<div class="rf-line">'
      + '<h3>Vacant Position ' + (index + 1) + '</h3>'
      + metaRow('Position Title', line.positionTitle || '—')
      + (line.positionNumber ? metaRow('Position Number', line.positionNumber) : '')
      + metaRow('Vacant Since', formatDateForDisplay(line.vacantSince))
      + metaRow('Time Vacant', line.timeVacant || '—')
      + metaRow('Plan to Fill', line.planToFill || '—')
      + (line.notes ? metaRow('Notes', line.notes) : '')
      + '</div>';
  });

  function accountBlock(heading, line, index) {
    var account = line.account || {};
    var accountNumber = buildAccountNumber(department.code, account, line.projectCode);
    var currentBudget = parseFloat(line.currentFiscalYearBudget);
    return '<div class="rf-line">'
      + '<h3>' + escapeHtml(heading) + ' ' + (index + 1) + '</h3>'
      + (line.vendorName ? metaRow('Vendor / Contractor Name', line.vendorName) : '')
      + metaRow('Expense Account', accountNumber + (account.name ? ' - ' + account.name : ''))
      + (line.projectCode ? metaRow('Project Number', line.projectCode) : '')
      + (isFinite(currentBudget) ? metaRow('Current FY Budget', formatCurrency(currentBudget)) : '')
      + metaRow('Requested Amount', formatCurrency(parseFloat(line.amount) || 0))
      + '<div class="meta"><b>Justification:</b></div>'
      + '<div class="justification">' + escapeHtml(line.justification || '') + '</div>'
      + '</div>';
  }

  var operationsHtml = section('Operations', sections.operations, function (line, index) {
    return accountBlock('Operating Line Item', line, index);
  });
  var contractualHtml = section('Contractual Services', sections.contractualServices, function (line, index) {
    return accountBlock('Contractual Service', line, index);
  });

  var capitalHtml = section('Capital Requests', sections.capital, function (line, index) {
    return '<div class="rf-line">'
      + '<h3>Capital Item ' + (index + 1) + '</h3>'
      + metaRow('Type', line.type || '—')
      + metaRow('Description', line.description || '—')
      + metaRow('Quantity', line.quantity || '—')
      + metaRow('Estimated Unit Cost', formatCurrency(parseFloat(line.unitCost) || 0))
      + metaRow('Total Estimated Cost', formatCurrency(parseFloat(line.totalCost) || 0))
      + '<div class="meta"><b>Justification:</b></div>'
      + '<div class="justification">' + escapeHtml(line.justification || '') + '</div>'
      + '</div>';
  });

  return '<html><head><meta charset="UTF-8"><style>' + css + '</style></head><body>'
    + '<h1>Budget Request</h1>'
    + '<div class="meta"><b>Request ID:</b> ' + escapeHtml(requestId) + '</div>'
    + '<div class="meta"><b>Date:</b> ' + escapeHtml(formatDateForDisplay(data.date))
      + '&nbsp;&nbsp;&nbsp;<b>Requester Name:</b> ' + escapeHtml(data.requesterName || '')
      + '&nbsp;&nbsp;&nbsp;<b>Title:</b> ' + escapeHtml(data.title || '') + '</div>'
    + '<div class="meta"><b>Requester Email:</b> ' + escapeHtml(data.requesterEmail || '') + '</div>'
    + '<div class="meta"><b>Department:</b> ' + escapeHtml(formatDepartmentForDisplay(department)) + '</div>'
    + '<div class="meta"><b>Fiscal Year:</b> ' + escapeHtml(data.fiscalYear || '') + '</div>'
    + newStaffingHtml + vacanciesHtml + operationsHtml + contractualHtml + capitalHtml
    + '<div class="total">Grand Total Requested: ' + formatCurrency(totals.grand) + '</div>'
    + '</body></html>';
}

/**
 * Builds the Grant Amendment Request PDF blob, attached to the county
 * notification email. Mirrors buildRequestPdf()/buildRollforwardPdf()'s
 * shape — a single blob, never written to Drive, that exists only for
 * the lifetime of this request.
 */
function buildGrantPdf(data, requestId, timestamp, accounts, amount) {
  var html = buildGrantHtml(data, requestId, timestamp, accounts, amount);
  var htmlBlob = Utilities.newBlob(html, 'text/html', 'grant.html');
  var pdfBlob = htmlBlob.getAs('application/pdf');
  pdfBlob.setName('Grant-Amendment-Request-' + requestId + '.pdf');
  return pdfBlob;
}

function buildGrantHtml(data, requestId, timestamp, accounts, amount) {
  var department = data.department || {};
  var css = buildPdfCss();
  var grantSourceLabel = data.grantSource === 'federal' ? 'Federal Grant' : 'State Grant';
  var typeCode = GRANT_TYPE_CODES[data.grantSource] || '';
  var activityDisplay = typeCode && data.activityCode
    ? (typeCode + '.' + data.activityCode + (data.activityLabel ? ' — ' + data.activityLabel : ''))
    : '';
  var categoryLabels = {
    equipment: 'Equipment', construction: 'Construction', design: 'Design',
    salaries: 'Salaries', other: 'Other',
  };

  return '<html><head><meta charset="UTF-8"><style>' + css + '</style></head><body>'
    + '<h1>Grant Amendment Request</h1>'
    + '<div class="meta"><b>Request ID:</b> ' + escapeHtml(requestId) + '</div>'
    + '<div class="meta"><b>Prepared By:</b> ' + escapeHtml(data.preparedBy || '')
      + '&nbsp;&nbsp;&nbsp;<b>Title:</b> ' + escapeHtml(data.title || '') + '</div>'
    + '<div class="meta"><b>Requestor Email:</b> ' + escapeHtml(data.requestorEmail || '') + '</div>'
    + '<div class="meta"><b>Grant Source:</b> ' + escapeHtml(grantSourceLabel)
      + '&nbsp;&nbsp;&nbsp;<b>Activity:</b> ' + escapeHtml(activityDisplay) + '</div>'
    + '<div class="meta"><b>Department:</b> ' + escapeHtml(formatDepartmentForDisplay(department)) + '</div>'
    + '<div class="meta"><b>Category:</b> ' + escapeHtml(categoryLabels[data.category] || '')
      + '&nbsp;&nbsp;&nbsp;<b>Grant Number:</b> ' + escapeHtml(data.grantNumber || '—') + '</div>'
    + '<div class="meta"><b>Granting Agency:</b> ' + escapeHtml(data.grantingAgency || '') + '</div>'
    + '<div class="meta"><b>Grant Program:</b> ' + escapeHtml(data.grantProgramName || '') + '</div>'
    + '<div class="meta"><b>Board Approval Date:</b> ' + escapeHtml(formatDateForDisplay(data.boardApprovalDate)) + '</div>'
    + '<div class="tables">'
    + '<div class="table-col"><h2>Revenue Account</h2>'
      + '<div class="meta">' + escapeHtml(accounts.revenueAccountNumber) + '</div>'
      + '<div class="total">Amount: ' + formatCurrency(amount) + '</div></div>'
    + '<div class="table-col"><h2>Expense Account</h2>'
      + '<div class="meta">' + escapeHtml(accounts.expenseAccountNumber) + '</div>'
      + '<div class="total">Amount: ' + formatCurrency(amount) + '</div></div>'
    + '</div>'
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

  var body = 'A Budget Request has been submitted.\n\n'
    + 'Request ID:\n' + requestId + '\n\n'
    + 'Department:\n' + (department ? department.name : '—') + '\n\n'
    + 'Amendment Type:\n' + (AMENDMENT_TYPE_LABELS[data.amendmentType] || '') + '\n\n'
    + 'Total Transfer Amount:\n' + formatCurrency(totalAmount) + '\n\n'
    + 'Submitted By:\n' + (data.preparedBy || '') + '\n\n'
    + 'Requestor Email:\n' + (data.requestorEmail || '') + '\n\n'
    + 'Submission Date:\n' + formatTimestampForEmail(timestamp) + '\n\n'
    + 'The completed Budget Request is attached.';

  MailApp.sendEmail({
    to: settings.NotificationEmails.join(','),
    subject: 'Budget Request Submitted – Request #' + requestId,
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

  var body = 'A Rollforward Request has been submitted.\n\n'
    + 'Request ID:\n' + requestId + '\n\n'
    + 'Date:\n' + formatDateForDisplay(data.date) + '\n\n'
    + 'Department:\n' + (department.name || '—') + '\n\n'
    + 'Number of Accounts:\n' + lines.length + '\n\n'
    + 'Total Amount Requested to Roll Forward:\n' + formatCurrency(totalAmount) + '\n\n'
    + 'Fiscal Year:\n' + (data.fiscalYear || '') + '\n\n'
    + 'Requester:\n' + (data.requesterName || '') + '\n\n'
    + 'Title:\n' + (data.title || '') + '\n\n'
    + 'Requester Email:\n' + (data.requesterEmail || '') + '\n\n'
    + 'Submission Date:\n' + formatTimestampForEmail(timestamp) + '\n\n'
    + 'See the attached PDF for the account-by-account amounts and justifications.';

  MailApp.sendEmail({
    to: settings.NotificationEmails.join(','),
    subject: 'Rollforward Request Submitted – Request #' + requestId,
    body: body,
    attachments: [pdfBlob],
  });
}

/**
 * Emails the submitted Budget Request's PDF to every address in
 * Settings!NotificationEmails. Only the county notification sends; the
 * requester is not emailed. The email body summarizes item counts and
 * totals per section (any section with zero lines is omitted); full
 * line-by-line detail is in the attached PDF.
 */
function sendBudgetRequestNotification(settings, data, requestId, timestamp, sections, totals, pdfBlob) {
  if (settings.NotificationEmails.length === 0) return;

  var department = data.department || {};

  var sectionLines = [];
  if (sections.newStaffing.length > 0) {
    sectionLines.push('New Staffing Requests: ' + sections.newStaffing.length + ' position(s), ' + formatCurrency(totals.newStaffing));
  }
  if (sections.vacancies.length > 0) {
    sectionLines.push('Current Vacancies: ' + sections.vacancies.length + ' position(s)');
  }
  if (sections.operations.length > 0) {
    sectionLines.push('Operations: ' + sections.operations.length + ' line item(s), ' + formatCurrency(totals.operations));
  }
  if (sections.contractualServices.length > 0) {
    sectionLines.push('Contractual Services: ' + sections.contractualServices.length + ' item(s), ' + formatCurrency(totals.contractualServices));
  }
  if (sections.capital.length > 0) {
    sectionLines.push('Capital Requests: ' + sections.capital.length + ' item(s), ' + formatCurrency(totals.capital));
  }

  var body = 'A Budget Request has been submitted.\n\n'
    + 'Request ID:\n' + requestId + '\n\n'
    + 'Date:\n' + formatDateForDisplay(data.date) + '\n\n'
    + 'Department:\n' + (department.name || '—') + '\n\n'
    + sectionLines.join('\n') + '\n\n'
    + 'Grand Total Requested:\n' + formatCurrency(totals.grand) + '\n\n'
    + 'Requesting Funding For Fiscal Year:\n' + (data.fiscalYear || '') + '\n\n'
    + 'Requester:\n' + (data.requesterName || '') + '\n\n'
    + 'Title:\n' + (data.title || '') + '\n\n'
    + 'Requester Email:\n' + (data.requesterEmail || '') + '\n\n'
    + 'Submission Date:\n' + formatTimestampForEmail(timestamp) + '\n\n'
    + 'See the attached PDF for full section-by-section detail and justifications.';

  MailApp.sendEmail({
    to: settings.NotificationEmails.join(','),
    subject: 'Budget Request Submitted – Request #' + requestId,
    body: body,
    attachments: [pdfBlob],
  });
}

/**
 * Emails the submitted Grant Amendment request's PDF to every address in
 * Settings!NotificationEmails — mirrors sendCountyNotification()'s/
 * sendRollforwardNotification()'s shape. Only the county notification
 * sends; the requester is not emailed.
 */
function sendGrantNotification(settings, data, requestId, timestamp, accounts, amount, pdfBlob) {
  if (settings.NotificationEmails.length === 0) return;

  var department = data.department || {};
  var grantSourceLabel = data.grantSource === 'federal' ? 'Federal' : 'State';
  var typeCode = GRANT_TYPE_CODES[data.grantSource] || '';
  var activityDisplay = typeCode && data.activityCode
    ? (typeCode + '.' + data.activityCode + (data.activityLabel ? ' — ' + data.activityLabel : ''))
    : '';

  var body = 'A Grant Amendment Request has been submitted.\n\n'
    + 'Request ID:\n' + requestId + '\n\n'
    + 'Grant Source:\n' + grantSourceLabel + '\n\n'
    + 'Activity:\n' + activityDisplay + '\n\n'
    + 'Department:\n' + (department.name || '—') + '\n\n'
    + 'Amount:\n' + formatCurrency(amount) + '\n\n'
    + 'Revenue Account:\n' + accounts.revenueAccountNumber + '\n\n'
    + 'Expense Account:\n' + accounts.expenseAccountNumber + '\n\n'
    + 'Grant Number:\n' + (data.grantNumber || '—') + '\n\n'
    + 'Granting Agency:\n' + (data.grantingAgency || '') + '\n\n'
    + 'Grant Program:\n' + (data.grantProgramName || '') + '\n\n'
    + 'Board Approval Date:\n' + formatDateForDisplay(data.boardApprovalDate) + '\n\n'
    + 'Prepared By:\n' + (data.preparedBy || '') + '\n\n'
    + 'Title:\n' + (data.title || '') + '\n\n'
    + 'Requestor Email:\n' + (data.requestorEmail || '') + '\n\n'
    + 'Submission Date:\n' + formatTimestampForEmail(timestamp) + '\n\n'
    + 'See the attached PDF for full details.';

  MailApp.sendEmail({
    to: settings.NotificationEmails.join(','),
    subject: 'Grant Amendment Request Submitted – Request #' + requestId,
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
