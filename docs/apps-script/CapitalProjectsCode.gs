/**
 * Capital Improvement Plan JSON proxy + in-place update endpoint.
 *
 * Paste this entire file into the Apps Script editor of the script bound
 * to the county's Capital Improvement Plan workbook (Extensions -> Apps
 * Script) — the spreadsheet with the "Capital Improvement Plan" tab. This
 * is a SEPARATE Apps Script project and deployment from the Chart of
 * Accounts one used by Transfer/Grant/Rollforward/Budget Request (see
 * Code.gs) — they live in two different Google Sheets workbooks, so each
 * needs its own bound script and its own deployed Web App URL.
 * capital-projects.html calls this deployment's URL directly (see
 * CIP_API_URL in js/capitalProjects.js), never the Chart of Accounts
 * SHEETS_API_URL.
 *
 * doGet returns { capitalProjects: [...], fetchedAt }.
 * doPost handles three request types: 'capitalProjectUpdate' (see
 * handleCapitalProjectUpdate() — finds an existing "Capital Improvement
 * Plan" row by project name and rewrites ONLY the field(s) actually
 * present in the request, a deliberate partial update, leaving every
 * other column untouched), 'capitalProjectCreate' (appends a brand-new
 * row — see handleCapitalProjectCreate()), and 'capitalProjectDelete'
 * (permanently removes a row — see handleCapitalProjectDelete()).
 *
 * Expected tab and exact header row text — "Capital Improvement Plan":
 *
 *   Budget Project Name(s) | Dept | Budget Project Code(s) |
 *   Commissioner District | Estimated Completion Date | Budget Fund(s) |
 *   Location Name | Operational Impact |
 *   Pertinent Information | Project Manager | Project Narrative |
 *   Project Phase | Project Priority | Start Date | Strategic Goals |
 *   Budget Org Code(s) | Budget Account Code(s) | Budget Account Name(s) |
 *   In-House Engineering | Status | FY2022 Proposed | FY2023 Proposed |
 *   FY2024 Proposed | FY2025 Proposed | FY2026 Proposed |
 *   FY2027 Proposed | FY2028 Proposed | FY2029 Proposed |
 *   FY2030 Proposed | FY2031 Proposed | Total FY2027-FY2031 |
 *   Status Notes | Last Updated | Last Updated By
 *
 * The county's original budget-book columns cover FY2027-2031 (the live
 * proposed CIP); "Status" and the five FY2022-FY2026 Proposed columns are
 * new, added so the historical project record — a one-time import of 161
 * FY2022-2026 projects from budgetv2's historical archive; the import
 * code has since been deleted from this file since its job is done —
 * lives in this SAME sheet/tab as the live projects, not a separate one.
 * "Status Notes", "Last Updated", and "Last Updated By" are the only
 * columns with no county-sourced equivalent at all.
 * `Budget Project Name(s)` is the row-matching key — the sheet has no
 * separate ID column, and names are unique in the live workbook.
 *
 * Both doGet and doPost require a valid Microsoft Entra ID (Azure AD)
 * access token — see verifyGraphUser() below — and doPost additionally
 * requires the signed-in user's email to be on this workbook's
 * "Authorized Users" tab. This means deploying this script for the
 * first time (or any time after adding the UrlFetchApp.fetch() calls in
 * verifyGraphUser) prompts for an additional OAuth scope
 * (script.external_request, to call Microsoft Graph) beyond doGet's
 * Sheets access.
 *
 * See docs/google-sheets-integration.md §10 for full setup steps,
 * including the Entra ID/allowlist setup this authentication depends on.
 */

// =============================================================
// Microsoft Entra ID (Azure AD) authentication
// =============================================================
//
// The frontend (js/auth.js) signs every visitor in via MSAL against
// the county's own Entra ID tenant before it ever calls this
// deployment — the tenant-specific authority in that config means
// only accounts in the org's tenant can obtain a token in the first
// place. What Apps Script does here is verify that a request
// actually carries a token that tenant issued (rather than trusting
// the caller's word for it) and, for writes, that the signed-in user
// is on this workbook's own "Authorized Users" allowlist.
//
// Verification works by asking Microsoft directly rather than
// checking the JWT signature ourselves — Apps Script has no built-in
// RSA/JWT-signature verification, and re-implementing one here would
// be a lot of fragile crypto code for this to depend on. Instead,
// verifyGraphUser() calls Microsoft Graph's /me endpoint as that
// token; Graph itself rejects an invalid, expired, or forged token
// with a 401, so a 200 response IS the proof the token is genuine
// and unexpired, and its body gives us the verified user identity.

// Calls Microsoft Graph's /me endpoint with `accessToken` as a
// Bearer token. Returns { email, name } if Microsoft accepts the
// token, or null if it's missing, expired, or invalid — never
// throws, so every caller can treat null as "not signed in" without
// its own try/catch.
function verifyGraphUser(accessToken) {
  if (!accessToken) return null;
  try {
    var response = UrlFetchApp.fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: 'Bearer ' + accessToken },
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() !== 200) return null;
    var profile = JSON.parse(response.getContentText());
    var email = profile.mail || profile.userPrincipalName || '';
    if (!email) return null;
    return { email: email.toLowerCase(), name: profile.displayName || email };
  } catch (err) {
    console.error('verifyGraphUser failed: ' + (err && err.stack ? err.stack : err));
    return null;
  }
}

// Checks a verified email against the "Authorized Users" tab (one
// email per row, any column header — the whole tab is read as a flat
// list). This is the write-access allowlist: being a real employee
// with a valid tenant token (verifyGraphUser) is enough to READ the
// ledger, but writing (create/update/delete) additionally requires
// being on this list, maintained directly in the spreadsheet by
// whoever administers it — no Azure AD app-role configuration
// required. See docs/google-sheets-integration.md §10.
function isAuthorizedEditor(email, ss) {
  var sheet = ss.getSheetByName('Authorized Users');
  if (!sheet) return false; // fail closed — an unconfigured allowlist authorizes nobody, not everybody
  var values = sheet.getDataRange().getValues();
  return values.some(function (row) {
    return row.some(function (cell) {
      return String(cell || '').trim().toLowerCase() === email;
    });
  });
}

// TEMPORARY KILL SWITCH — set to true to re-enable authentication. While
// false, doGet/doPost skip the Microsoft token check and the Authorized
// Users allowlist entirely, so ANYONE with the URL can read, edit, and
// delete. Must be flipped together with AUTH_ENABLED in js/auth.js, then
// redeployed (Deploy → Manage deployments → New version).
var AUTH_REQUIRED = false;

function doGet(e) {
  try {
    if (AUTH_REQUIRED) {
      var user = verifyGraphUser(e.parameter && e.parameter.accessToken);
      if (!user) {
        return jsonResponse({ error: 'Not signed in. Please sign in and try again.' });
      }
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var payload = {
      capitalProjects: readSheet(ss, 'Capital Improvement Plan', mapCapitalProjectRow),
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

// Parses currency/number-formatted cells (Sheets may hand back a number,
// a formatted string, or blank) into a plain number, defaulting
// blank/unparseable cells to 0 so ledger totals never break on NaN.
function numberCell(record, header) {
  var raw = record[header];
  if (raw === undefined || raw === null || raw === '') return 0;
  var num = Number(String(raw).replace(/[^0-9.\-]/g, ''));
  return isNaN(num) ? 0 : num;
}

function mapCapitalProjectRow(record) {
  return {
    projectName: cell(record, 'Budget Project Name(s)'),
    isHistorical: cell(record, 'Is Historical').toLowerCase() === 'yes',
    dept: cell(record, 'Dept'),
    projectCode: cell(record, 'Budget Project Code(s)'),
    commissionerDistrict: cell(record, 'Commissioner District'),
    estCompletionDate: cell(record, 'Estimated Completion Date'),
    fund: cell(record, 'Budget Fund(s)'),
    locationName: cell(record, 'Location Name'),
    operationalImpact: cell(record, 'Operational Impact'),
    pertinentInformation: cell(record, 'Pertinent Information'),
    projectManager: cell(record, 'Project Manager'),
    projectNarrative: cell(record, 'Project Narrative'),
    phase: cell(record, 'Project Phase'),
    priority: cell(record, 'Project Priority'),
    startDate: cell(record, 'Start Date'),
    strategicGoals: cell(record, 'Strategic Goals'),
    orgCode: cell(record, 'Budget Org Code(s)'),
    accountCode: cell(record, 'Budget Account Code(s)'),
    accountName: cell(record, 'Budget Account Name(s)'),
    inHouseEngineering: cell(record, 'In-House Engineering'),
    youtubeUrl: cell(record, 'YouTube Video URL'),
    status: cell(record, 'Status'),
    fy2022: numberCell(record, 'FY2022 Proposed'),
    fy2023: numberCell(record, 'FY2023 Proposed'),
    fy2024: numberCell(record, 'FY2024 Proposed'),
    fy2025: numberCell(record, 'FY2025 Proposed'),
    fy2026: numberCell(record, 'FY2026 Proposed'),
    fy2027: numberCell(record, 'FY2027 Proposed'),
    fy2028: numberCell(record, 'FY2028 Proposed'),
    fy2029: numberCell(record, 'FY2029 Proposed'),
    fy2030: numberCell(record, 'FY2030 Proposed'),
    fy2031: numberCell(record, 'FY2031 Proposed'),
    totalFy2027to2031: numberCell(record, 'Total FY2027-FY2031'),
    totalProjectCost: numberCell(record, 'Total Project Cost'),
    statusNotes: cell(record, 'Status Notes'),
    lastUpdated: cell(record, 'Last Updated'),
    lastUpdatedBy: cell(record, 'Last Updated By'),
  };
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function isValidLength(value, maxLength) {
  return String(value || '').length <= maxLength;
}

/**
 * Input: e.postData.contents — a JSON string matching
 * { requestType: 'capitalProjectUpdate', projectName, phase, statusNotes,
 * updatedBy }. Sent with no explicit Content-Type header on purpose —
 * Apps Script Web Apps can't handle a CORS preflight (OPTIONS) request,
 * and a plain-string fetch() body defaults to "text/plain", which
 * browsers exempt from preflight; the raw body is parsed as JSON
 * regardless of the declared type.
 *
 * Output: a JSON response { success: true, projectName } on success, or
 * { success: false, error } on failure. Never throws — every failure path
 * is caught and reported in the response body.
 */
function doPost(e) {
  try {
    var requestData = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (AUTH_REQUIRED) {
      var user = verifyGraphUser(requestData && requestData.accessToken);
      if (!user) {
        return jsonResponse({ success: false, error: 'Not signed in. Please sign in and try again.' });
      }
      if (!isAuthorizedEditor(user.email, ss)) {
        return jsonResponse({
          success: false,
          error: 'Your account (' + user.email + ') is not authorized to make changes here. '
            + 'Ask whoever administers this workbook to add you to the "Authorized Users" tab.',
        });
      }
    }

    if (requestData && requestData.requestType === 'capitalProjectCreate') {
      return jsonResponse(handleCapitalProjectCreate(ss, requestData));
    }
    if (requestData && requestData.requestType === 'capitalProjectDelete') {
      return jsonResponse(handleCapitalProjectDelete(ss, requestData));
    }
    if (!requestData || requestData.requestType !== 'capitalProjectUpdate') {
      return jsonResponse({ success: false, error: 'Unknown or missing requestType.' });
    }
    return jsonResponse(handleCapitalProjectUpdate(ss, requestData));
  } catch (err) {
    console.error('doPost failed: ' + (err && err.stack ? err.stack : err));
    return jsonResponse({ success: false, error: String(err && err.message ? err.message : err) });
  }
}

// Columns handleCapitalProjectUpdate() reads/writes. "Status Notes",
// "Last Updated", and "Last Updated By" are the only three columns this
// module requires the sheet to add — everything else (the row-matching
// key and Project Phase) already exists in the county's budget-book
// workbook. See docs/google-sheets-integration.md §10.
var CAPITAL_PROJECTS_KEY_COLUMN = 'Budget Project Name(s)';
var CAPITAL_PROJECTS_PHASE_COLUMN = 'Project Phase';
var CAPITAL_PROJECTS_WRITE_COLUMNS = [
  CAPITAL_PROJECTS_KEY_COLUMN, CAPITAL_PROJECTS_PHASE_COLUMN,
  'Dept', 'Project Priority', 'Status', 'Budget Fund(s)',
  'FY2022 Proposed', 'FY2023 Proposed', 'FY2024 Proposed', 'FY2025 Proposed', 'FY2026 Proposed',
  'FY2027 Proposed', 'FY2028 Proposed', 'FY2029 Proposed', 'FY2030 Proposed', 'FY2031 Proposed',
  'Status Notes', 'Last Updated', 'Last Updated By',
  'Budget Project Code(s)', 'Project Manager', 'Commissioner District', 'Location Name',
  'Start Date', 'Estimated Completion Date', 'In-House Engineering',
  'Project Narrative', 'Operational Impact', 'Pertinent Information', 'Strategic Goals',
  'YouTube Video URL', 'Total Project Cost',
];

// FY amount fields — { requestData key -> sheet column header }. Shared by
// the length/parse loop in handleCapitalProjectUpdate() so adding another
// fiscal year later only needs one new entry here. FY2022-FY2026 cover
// the historical project record; FY2027-FY2031 cover the live proposed CIP.
var CAPITAL_PROJECTS_AMOUNT_FIELDS = {
  fy2022: 'FY2022 Proposed',
  fy2023: 'FY2023 Proposed',
  fy2024: 'FY2024 Proposed',
  fy2025: 'FY2025 Proposed',
  fy2026: 'FY2026 Proposed',
  fy2027: 'FY2027 Proposed',
  fy2028: 'FY2028 Proposed',
  fy2029: 'FY2029 Proposed',
  fy2030: 'FY2030 Proposed',
  fy2031: 'FY2031 Proposed',
  // Not a fiscal-year amount — the whole project's total cost across all
  // years — but it parses/validates identically (non-negative number).
  totalProjectCost: 'Total Project Cost',
};

// Free-text fields — { requestData key -> [sheet column header, max length] }.
// Shared by the length-validation loop and the write loop below. `status`
// (In Progress / Complete / Programmed / ...) is distinct from Project
// Phase (Design / Construction / ...) — a historical-record concept
// (whether the work is finished) that's editable the same way as
// everything else here even for live FY2027-2031 projects.
var CAPITAL_PROJECTS_TEXT_FIELDS = {
  status: ['Status', 60],
  fund: ['Budget Fund(s)', 100],
  projectCode: ['Budget Project Code(s)', 60],
  projectManager: ['Project Manager', 100],
  commissionerDistrict: ['Commissioner District', 60],
  locationName: ['Location Name', 200],
  startDate: ['Start Date', 60],
  estCompletionDate: ['Estimated Completion Date', 60],
  inHouseEngineering: ['In-House Engineering', 60],
  projectNarrative: ['Project Narrative', 4000],
  operationalImpact: ['Operational Impact', 2000],
  pertinentInformation: ['Pertinent Information', 4000],
  strategicGoals: ['Strategic Goals', 1000],
  youtubeUrl: ['YouTube Video URL', 500],
};

/**
 * Handles a Capital Project update from capital-project.html — finds an
 * existing "Capital Improvement Plan" row by its project name (the sheet
 * has no separate ID column, and project names are unique in the live
 * workbook) and rewrites ONLY the columns whose requestData key is
 * actually present in the payload, leaving every other column (including
 * every other editable one) untouched.
 *
 * This is a deliberate partial-update design, not an oversight: the page
 * saves one field at a time (e.g. just fy2031 when a single amount is
 * edited), and an earlier full-snapshot design — sending every editable
 * field on every save, filled in from the browser's last-known copy of
 * the row — silently reverted other fields to stale values whenever two
 * edits landed close together (a race between two in-flight saves) or the
 * browser's cached copy was older than the sheet (e.g. edited from a
 * second tab, or a stale sessionStorage cache). Only ever writing what
 * was actually sent removes both failure modes: a field neither present
 * in the payload nor about to be looked up from a possibly-stale local
 * copy simply isn't touched.
 *
 * Input: the spreadsheet, and { projectName, updatedBy, plus any subset
 * of: newProjectName, phase, dept, priority, fy2027..fy2031, statusNotes, projectCode,
 * projectManager, commissionerDistrict, locationName,
 * startDate, estCompletionDate, inHouseEngineering, projectNarrative }.
 * Output: { success: true, projectName } or { success: false, error }.
 */
function handleCapitalProjectUpdate(ss, requestData) {
  var projectName = String(requestData && requestData.projectName || '').trim();
  if (!projectName) {
    return { success: false, error: 'Project name is required.' };
  }

  // header -> value to write. Built up only from keys actually present on
  // requestData (checked with `!== undefined`, not truthiness — a blank
  // string or 0 is a legitimate value to write, not "field not sent").
  var updates = {};

  if (requestData.newProjectName !== undefined) {
    var newProjectName = String(requestData.newProjectName || '').trim();
    if (!newProjectName) {
      return { success: false, error: 'Project name is required.' };
    }
    if (!isValidLength(newProjectName, 200)) {
      return { success: false, error: 'Project name is too long.' };
    }
    updates[CAPITAL_PROJECTS_KEY_COLUMN] = newProjectName;
  }

  if (requestData.phase !== undefined) {
    var phase = String(requestData.phase || '').trim();
    if (!phase) {
      return { success: false, error: 'Project Phase cannot be blank.' };
    }
    if (!isValidLength(phase, 60)) {
      return { success: false, error: 'Project Phase is too long.' };
    }
    updates[CAPITAL_PROJECTS_PHASE_COLUMN] = phase;
  }

  if (requestData.dept !== undefined) {
    var dept = String(requestData.dept || '').trim();
    if (!isValidLength(dept, 100)) {
      return { success: false, error: 'Dept is too long.' };
    }
    updates['Dept'] = dept;
  }

  if (requestData.priority !== undefined) {
    var priority = String(requestData.priority || '').trim();
    if (!isValidLength(priority, 60)) {
      return { success: false, error: 'Priority is too long.' };
    }
    updates['Project Priority'] = priority;
  }

  if (requestData.statusNotes !== undefined) {
    if (!isValidLength(requestData.statusNotes, 2000)) {
      return { success: false, error: 'Status Notes is too long.' };
    }
    updates['Status Notes'] = String(requestData.statusNotes || '');
  }

  for (var amountField in CAPITAL_PROJECTS_AMOUNT_FIELDS) {
    if (requestData[amountField] === undefined) continue;
    var raw = requestData[amountField];
    var num = raw === null || raw === '' ? 0 : Number(raw);
    if (!isFinite(num) || num < 0) {
      return { success: false, error: 'Each FY amount must be a non-negative number.' };
    }
    updates[CAPITAL_PROJECTS_AMOUNT_FIELDS[amountField]] = num;
  }

  for (var textField in CAPITAL_PROJECTS_TEXT_FIELDS) {
    if (requestData[textField] === undefined) continue;
    var maxLength = CAPITAL_PROJECTS_TEXT_FIELDS[textField][1];
    var value = String(requestData[textField] || '').trim();
    if (!isValidLength(value, maxLength)) {
      return { success: false, error: 'One of the edited fields is too long.' };
    }
    if (textField === 'youtubeUrl' && value && !/(?:youtube\.com|youtu\.be)/i.test(value)) {
      return { success: false, error: 'YouTube Video URL must be a youtube.com or youtu.be link.' };
    }
    updates[CAPITAL_PROJECTS_TEXT_FIELDS[textField][0]] = value;
  }

  if (Object.keys(updates).length === 0) {
    return { success: false, error: 'No fields to update were provided.' };
  }

  var sheet = ss.getSheetByName('Capital Improvement Plan');
  if (!sheet) {
    return { success: false, error: 'Sheet not found: "Capital Improvement Plan". See docs/google-sheets-integration.md §10.' };
  }

  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function (header) { return String(header).trim(); });
  var colIndex = {};
  CAPITAL_PROJECTS_WRITE_COLUMNS.forEach(function (name) {
    colIndex[name] = headers.indexOf(name);
  });
  if (colIndex[CAPITAL_PROJECTS_KEY_COLUMN] === -1) {
    return { success: false, error: 'Capital Improvement Plan sheet is missing its "' + CAPITAL_PROJECTS_KEY_COLUMN + '" column.' };
  }

  var rowIndex = -1;
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][colIndex[CAPITAL_PROJECTS_KEY_COLUMN]]).trim() === projectName) {
      rowIndex = i;
      break;
    }
  }
  if (rowIndex === -1) {
    return { success: false, error: 'No Capital Improvement Plan row found with project name "' + projectName + '".' };
  }

  if (newProjectName && newProjectName !== projectName) {
    for (var duplicateIndex = 1; duplicateIndex < values.length; duplicateIndex++) {
      if (duplicateIndex !== rowIndex
          && String(values[duplicateIndex][colIndex[CAPITAL_PROJECTS_KEY_COLUMN]]).trim() === newProjectName) {
        return { success: false, error: 'A project named "' + newProjectName + '" already exists.' };
      }
    }
  }

  var sheetRow = rowIndex + 1; // getRange is 1-indexed; values is 0-indexed.
  Object.keys(updates).forEach(function (header) {
    if (colIndex[header] !== -1) {
      sheet.getRange(sheetRow, colIndex[header] + 1).setValue(updates[header]);
    }
  });
  if (colIndex['Last Updated'] !== -1) {
    sheet.getRange(sheetRow, colIndex['Last Updated'] + 1).setValue(new Date());
  }
  if (colIndex['Last Updated By'] !== -1) {
    sheet.getRange(sheetRow, colIndex['Last Updated By'] + 1).setValue(String(requestData.updatedBy || ''));
  }

  return { success: true, projectName: newProjectName || projectName };
}

/**
 * Handles creating a brand-new Capital Improvement Plan project from
 * capital-project.html's "New Project" form. Appends one row rather than
 * finding an existing one — the only doPost branch here that adds a row
 * instead of editing one in place.
 *
 * Input: { requestType: 'capitalProjectCreate', projectName, dept, fund,
 * phase, updatedBy }. `phase` defaults to "Identification" and `dept`/
 * `fund` may be blank if not provided — every other field starts blank
 * and is filled in later from the new project's own detail page (same
 * capitalProjectUpdate path everything else uses).
 * Output: { success: true, projectName } or { success: false, error }.
 */
function handleCapitalProjectCreate(ss, requestData) {
  var projectName = String(requestData && requestData.projectName || '').trim();
  if (!projectName) {
    return { success: false, error: 'Project name is required.' };
  }
  if (!isValidLength(projectName, 200)) {
    return { success: false, error: 'Project name is too long.' };
  }

  var sheet = ss.getSheetByName('Capital Improvement Plan');
  if (!sheet) {
    return { success: false, error: 'Sheet not found: "Capital Improvement Plan". See docs/google-sheets-integration.md §10.' };
  }

  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function (header) { return String(header).trim(); });
  var colIndex = {};
  headers.forEach(function (header, i) { colIndex[header] = i; });

  if (colIndex[CAPITAL_PROJECTS_KEY_COLUMN] === undefined) {
    return { success: false, error: 'Sheet is missing its "' + CAPITAL_PROJECTS_KEY_COLUMN + '" column.' };
  }

  for (var i = 1; i < values.length; i++) {
    if (String(values[i][colIndex[CAPITAL_PROJECTS_KEY_COLUMN]] || '').trim() === projectName) {
      return { success: false, error: 'A project named "' + projectName + '" already exists.' };
    }
  }

  var dept = String(requestData.dept || '').trim();
  var fund = String(requestData.fund || '').trim();
  var phase = String(requestData.phase || '').trim() || 'Identification';
  if (!isValidLength(dept, 100) || !isValidLength(fund, 100) || !isValidLength(phase, 60)) {
    return { success: false, error: 'One of the entered fields is too long.' };
  }

  var row = headers.map(function (header) {
    switch (header) {
      case CAPITAL_PROJECTS_KEY_COLUMN: return projectName;
      case 'Dept': return dept;
      case 'Budget Fund(s)': return fund;
      case CAPITAL_PROJECTS_PHASE_COLUMN: return phase;
      case 'Project Priority': return 'None';
      case 'Status': return 'None';
      // A brand-new project always starts as a live proposed project,
      // never historical — this is what keeps isHistorical (see
      // mapCapitalProjectRow) correct going forward without needing to
      // infer it from FY amounts being zero, which a just-created
      // project's amounts always are until someone fills them in.
      case 'Is Historical': return 'No';
      case 'Last Updated': return new Date();
      case 'Last Updated By': return String(requestData.updatedBy || '');
      case 'FY2022 Proposed': case 'FY2023 Proposed': case 'FY2024 Proposed':
      case 'FY2025 Proposed': case 'FY2026 Proposed': case 'FY2027 Proposed':
      case 'FY2028 Proposed': case 'FY2029 Proposed': case 'FY2030 Proposed':
      case 'FY2031 Proposed':
        return 0;
      default: return '';
    }
  });

  sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([row]);

  return { success: true, projectName: projectName };
}

/**
 * Handles permanently deleting a Capital Improvement Plan project from
 * capital-project.html. This is destructive and, like every other
 * endpoint here, unauthenticated (the deployment is public "Anyone"
 * access, matching the rest of this v1 no-login design) — the page
 * itself is expected to confirm with the user before calling this. Row
 * deletion also isn't undo-able the way Sheets' own edit history can
 * undo a cell edit, though Google Sheets' Version History can still
 * recover a deleted row if needed.
 *
 * Input: { requestType: 'capitalProjectDelete', projectName }.
 * Output: { success: true, projectName } or { success: false, error }.
 */
function handleCapitalProjectDelete(ss, requestData) {
  var projectName = String(requestData && requestData.projectName || '').trim();
  if (!projectName) {
    return { success: false, error: 'Project name is required.' };
  }

  var sheet = ss.getSheetByName('Capital Improvement Plan');
  if (!sheet) {
    return { success: false, error: 'Sheet not found: "Capital Improvement Plan". See docs/google-sheets-integration.md §10.' };
  }

  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function (header) { return String(header).trim(); });
  var colIndex = {};
  headers.forEach(function (header, i) { colIndex[header] = i; });

  if (colIndex[CAPITAL_PROJECTS_KEY_COLUMN] === undefined) {
    return { success: false, error: 'Sheet is missing its "' + CAPITAL_PROJECTS_KEY_COLUMN + '" column.' };
  }

  var rowIndex = -1;
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][colIndex[CAPITAL_PROJECTS_KEY_COLUMN]] || '').trim() === projectName) {
      rowIndex = i;
      break;
    }
  }
  if (rowIndex === -1) {
    return { success: false, error: 'No Capital Improvement Plan row found with project name "' + projectName + '".' };
  }

  sheet.deleteRow(rowIndex + 1); // getRange/deleteRow are 1-indexed; values is 0-indexed.

  return { success: true, projectName: projectName };
}

/**
 * One-time helper — run manually from the Apps Script editor (function
 * dropdown next to Run → backfillIsHistoricalFlag → Run) to populate the
 * "Is Historical" column for rows that predate it (every row imported
 * before mapCapitalProjectRow started reading that column instead of
 * comparing against the now-deleted HISTORICAL_CIP_PROJECTS source
 * array). Only touches rows where "Is Historical" is currently blank —
 * safe to re-run, and never overwrites a value already set (by this
 * function, handleCapitalProjectCreate, or by hand).
 *
 * Rule: "Yes" if the row has no FY2027-2031 proposed funding, "No"
 * otherwise. Verified safe against the live sheet before deleting the
 * historical-import code this replaces: every current row with any
 * FY2027-2031 amount has zero FY2022-2026 amount and vice versa — no
 * row currently mixes historical and live-proposed funding — so "no
 * FY2027-2031 funding" cleanly identifies every historical row,
 * including the ones with $0 recorded for every year (the "no amount
 * recorded" cases from the original import).
 */
function backfillIsHistoricalFlag() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Capital Improvement Plan');
  if (!sheet) {
    throw new Error('Sheet not found: "Capital Improvement Plan".');
  }

  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function (header) { return String(header).trim(); });
  var colIndex = {};
  headers.forEach(function (header, i) { colIndex[header] = i; });

  if (colIndex['Is Historical'] === undefined) {
    throw new Error('Sheet is missing its "Is Historical" column — add it before running this.');
  }

  var proposedColumns = ['FY2027 Proposed', 'FY2028 Proposed', 'FY2029 Proposed', 'FY2030 Proposed', 'FY2031 Proposed']
    .map(function (name) { return colIndex[name]; })
    .filter(function (i) { return i !== undefined; });

  var patched = 0;
  for (var row = 1; row < values.length; row++) {
    var current = String(values[row][colIndex['Is Historical']] || '').trim();
    if (current) continue; // already set — never overwrite

    var hasProposedFunding = proposedColumns.some(function (i) {
      return Number(String(values[row][i]).replace(/[^0-9.\-]/g, '')) > 0;
    });
    sheet.getRange(row + 1, colIndex['Is Historical'] + 1).setValue(hasProposedFunding ? 'No' : 'Yes');
    patched++;
  }

  Logger.log('Set "Is Historical" on ' + patched + ' row(s).');
}

