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
 * new, added so the historical project record (see
 * importHistoricalCipProjects() near the end of this file) can live in
 * this SAME sheet/tab as the live projects, not a separate one — one
 * unified project list, filterable/editable the same way regardless of
 * which years it was funded in. "Status Notes", "Last Updated", and
 * "Last Updated By" are the only columns with no county-sourced
 * equivalent at all. `Budget Project Name(s)` is the row-matching key —
 * the sheet has no separate ID column, and names are unique in the live
 * workbook.
 *
 * See docs/google-sheets-integration.md §10 for full setup steps,
 * including the one-time historical import.
 */

function doGet(e) {
  try {
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
    isHistorical: isHistoricalCapitalProject(record),
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
    statusNotes: cell(record, 'Status Notes'),
    lastUpdated: cell(record, 'Last Updated'),
    lastUpdatedBy: cell(record, 'Last Updated By'),
  };
}

// Identifies rows originating in the historical CIP source even when
// every FY2022-FY2026 amount is blank/zero. Project number is preferred
// because names can be edited in the management portal; name matching is
// the fallback for historical records that have no project number.
function isHistoricalCapitalProject(record) {
  if (!record) {
    Logger.log('isHistoricalCapitalProject is an internal helper; no standalone action is required.');
    return false;
  }
  var projectNumber = cell(record, 'Budget Project Code(s)');
  var projectName = cell(record, 'Budget Project Name(s)');
  return HISTORICAL_CIP_PROJECTS.some(function (entry) {
    var historicalNumber = String(entry.projectNumber || '').trim();
    return (projectNumber && historicalNumber && projectNumber === historicalNumber)
      || (!projectNumber && projectName === String(entry.name || '').trim());
  });
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
  'YouTube Video URL',
];

// FY amount fields — { requestData key -> sheet column header }. Shared by
// the length/parse loop in handleCapitalProjectUpdate() so adding another
// fiscal year later only needs one new entry here. FY2022-FY2026 cover
// the historical project record (see the one-time importHistoricalCipProjects()
// below); FY2027-FY2031 cover the live proposed CIP.
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

// =============================================================
// One-time historical CIP import (NOT reachable via doGet/doPost)
// =============================================================
//
// Vendored verbatim from budgetv2's assets/cip-fy2025-2026-supplement.js
// (github.com/budget-pixel/budgetv2), pulled 2026-08-27 — see
// docs/apps-script/historical-cip-source-data.js in this repo for the
// identical array with its full sourcing commentary (per-project
// citations to the County's 5-year work plans, general ledger, etc.).
// Not read by doGet — only importHistoricalCipProjects() below uses it,
// once.

// Historical Capital Project Repository (FY2022-FY2026)
// Source: County Engineering & Public Works and Sheriff's Office 5-year CIP
// worksheets (Beach Operations projects excluded; not needed on this site).
// These projects predate the FY2027 proposed CIP shown
// elsewhere on the site and are kept as a separate, completed/historical
// project repository -- not merged with the live FY2027-2031 project list --
// so residents can see the County's recent project track record.
//
// Two separate fields are tracked per project:
//   - phase:  where the project sits in the delivery lifecycle, normalized
//             to a short, consistent set of words (Design, Construction,
//             Programmed, Permitting, Report/Study).
//   - status: whether the work is finished -- Complete or In Progress.
// statusNote (where present) keeps the fuller detail behind the badge tooltip.
//
// fy2024 figures (added separately from the FY2025/FY2026 reconciliation
// below) come straight from the "Walton County Engineering & Public Works
// Department 5 Year Work Plan FY24-FY28" (BCC adopted February 27, 2024) --
// specifically its FY2024 present-day-costs column, which totals
// $33,259,700 across all funding types. Only rows carrying a budgeted FY2024
// dollar amount are included; unlike the FY2025/FY2026 entries below, these
// have not been cross-checked against a completion/status workbook, so they
// carry phase/funding source only (status: "Programmed") rather than a
// verified Complete/In Progress status, except where later confirmed.
//
// fy2023 figures come from the "FY 22/23 Walton County Public Works Capital
// Projects" list ($3,097,940 total) and the "FY 22/23 South Walton County
// Infrastructure Fund Capital Projects" list ($4,000,000 total), both Public
// Works Director approved -- combined $7,097,940. Same caveat as fy2024:
// not cross-checked against a completion workbook, so status is
// "Programmed" unless confirmed elsewhere.
//
// eng_color/eng note reconciliation (added after cross-checking against
// "walton-county-engineering-project-notes.md", the County's own FY25/FY26
// Engineering project-tracking workbook):
//   - No eng_color: matched a project in that workbook -- phase/statusNote
//     below reflects the workbook's phase + delivery/funding note.
//   - eng_color: "blue": on this ledger, but not found in that workbook.
//   - eng_color: "red": in that workbook, but wasn't already on this
//     ledger -- added here. Most have no dollar figure in the workbook (it
//     doesn't track budget); noBudgetYears marks which year(s) those should
//     still be shown under, displaying "No amount recorded" rather than a
//     fabricated number. Several were later updated with real amounts from
//     the County's finance system once available.
var HISTORICAL_CIP_PROJECTS = [
    { name: "13th Street Roadway & Drainage Improvements", projectNumber: "10312", completedDate: "10/2024", category: "Transportation & Public Works", fy2025: 0, fy2026: 304693, phase: "Design", status: "Complete", statusNote: "Design completed October 2024. The FY2026 capital work plan assigns $304,693." },
    { name: "Brown Road (Dirt to Pave)", projectNumber: "10537", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2025: 0, fy2026: 349500, phase: "Construction", status: "Programmed", statusNote: "The FY2026–30 work plan assigns $349,500 in Public Works capital funding. It does not appear on the current Public Works project table.", eng_color: "blue" },
    { name: "CR 1087 Southbound Right Turn Lane", projectNumber: "10638", category: "Transportation & Public Works", fy2025: 0, fy2026: 50000, phase: "Construction", status: "In Progress", statusNote: "Design completed FY2025; construction is not yet complete. Per County Engineering project notes (FY25, “CR 1087 & US HWY 90 Intersection SB RT Turnlane”): In-House Design/Permitting." },
    { name: "CR 83 S Pedestrian Path Extension", projectNumber: "10475", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2025: 125000, fy2026: 0, phase: "Design & Construction", status: "Programmed", statusNote: "Design phase complete. The County work plan programs construction/CEI much later, in FY2029 — not yet built.", eng_color: "blue" },
    { name: "Driftwood & Ellis Roadway & Drainage Improvements", projectNumber: "10564", startDate: "01/2026", category: "Transportation & Public Works", fy2025: 0, fy2026: 7480000, phase: "Construction", status: "In Progress", statusNote: "Appears on the county's current construction list; this is Phase 4, the final phase. The FY2026 capital work plan assigns $7,480,000. The construction contract was awarded December 18, 2025, with an anticipated construction period of approximately 420 days.", contracts: [
      { phase: "Construction", contractor: "RBM Contracting Services, LLC", amount: "$3,743,685.62", date: "12/18/2025", note: "Includes an approximately $193,000 utility-relocation alternate. South Walton Utility Company agreed to reimburse the County $192,910.35 for applicable water and sewer relocation costs under an agreement approved January 13, 2026." },
      { phase: "CEI", contractor: "Halff Associates, Inc.", amount: "Up to $447,541.05", note: "Construction Engineering and Inspection services." }
    ], eng_color: "blue" },
    { name: "East Violet Lane (Dirt to Pave)", projectNumber: "10567", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2025: 0, fy2026: 55500, phase: "Construction", status: "Programmed", statusNote: "$55,500 is listed for construction; no start date found.", eng_color: "blue" },
    { name: "Hinote Southbound Left Turn Lane", completedDate: "2025", category: "Transportation & Public Works", fy2025: 0, fy2026: 30000, phase: "Design & Construction", status: "Complete", statusNote: "Per County Engineering project notes (FY26, “Hinote Rd & US HWY 90 Intersection SB Right Turn Lane”): Construction phase, In-House CEI (Design phase recorded in FY25)." },
    { name: "Lafavre Lane (Dirt to Pave)", projectNumber: "10579", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2025: 0, fy2026: 55500, phase: "Construction", status: "Programmed", statusNote: "$55,500 is listed for construction; no start date found.", eng_color: "blue" },
    { name: "Meteyard Lane (Dirt to Pave)", projectNumber: "10585", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2025: 0, fy2026: 55500, phase: "Construction", status: "Programmed", statusNote: "$55,500 is listed for construction; no start date found.", eng_color: "blue" },
    { name: "N. Raphael Road Paving (Resurfacing)", projectNumber: "553000", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2025: 0, fy2026: 88500, phase: "Construction", status: "Programmed", statusNote: "The approved plan assigns $88,500 in Public Works maintenance funding, but it is not on the active-project table.", eng_color: "blue" },
    { name: "Grant Nellie Drive Connector Road", projectNumber: "10288", startDate: "03/2026", estimatedCompletionDate: "2026", category: "Transportation & Public Works", fy2025: 0, fy2026: 8200000, phase: "Construction", status: "In Progress", statusNote: "The county places it in the substantially-complete design category. The work plan estimates an $11.2 million total project cost and programs $8.2 million in FY2026 construction funding (including the $3,200,000 originally budgeted for FY2024 construction/CEI, funded by a legislative appropriation), plus wetland-mitigation funding.", contracts: [
      { phase: "Design", contractor: "Halff Associates, Inc.", contractNumber: "Contract 22-020", amount: "$1,675,744", date: "11/18/2022" },
      { phase: "Construction", contractor: "Gulf Coast Utility Contractors, LLC", contractNumber: "Contract 26-03", amount: "$7,577,111.55", date: "2/26/2026", note: "\"Old Town Santa Rosa Stormwater Management and Event Facility Phase 1 – Nellie Drive Extension\"" },
      { phase: "CEI", contractor: "Neel-Schaffer, Inc.", contractNumber: "Contract 26-05", amount: "$654,921.17", date: "3/10/2026" }
    ], eng_color: "blue" },
    { name: "Open Gulf, Norwood and Sandtrap Rd Drainage Improvements", projectNumber: "10589", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2025: 0, fy2026: 500000, phase: "Construction", status: "Programmed", statusNote: "The county lists the project under substantially-complete design efforts. The plan assigns $500,000 in FY2026 for materials-only, in-house construction.", eng_color: "blue" },
    { name: "Rembrandt Circle Paving (Resurfacing)", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2025: 0, fy2026: 43500, phase: "Construction", status: "Programmed", statusNote: "$43,500 is assigned through Public Works maintenance; no start date found.", eng_color: "blue" },
    { name: "Senior Center District 5", projectNumber: "10645", startDate: "04/2026", category: "Transportation & Public Works", fy2025: 0, fy2026: 1426962, phase: "Design", status: "In Progress", statusNote: "The county lists the South Walton Senior Center as a design project. Records also show additional funding activity for a senior center near the South Walton Annex, but the ledger's District 5 title is not used consistently online.", eng_color: "blue" },
    { name: "Driftwood Pointe Rd Sidewalk Phase 4 Final Phase", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2025: 0, fy2026: 175000, phase: "Construction", status: "Programmed", statusNote: "$175,000 assigned per the FY2026 capital work plan for the final phase of this sidewalk project.", eng_color: "blue" },
    { name: "Varnum Road #604124 Bridge Replacement", projectNumber: "10563", startDate: "06/2026", category: "Transportation & Public Works", fy2025: 0, fy2026: 400000, phase: "Design", status: "In Progress", statusNote: "The current plan assigns $400,000 to design and $550,000 to construction/CEI, but it is not listed on the county's current construction page.", eng_color: "blue" },
    { name: "W. Renoir Road Paving (Dirt to Pave)", projectNumber: "10560", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2025: 0, fy2026: 67500, phase: "Construction", status: "Programmed", statusNote: "$67,500 is listed for construction through Public Works capital; no start date found.", eng_color: "blue" },
    { name: "Grant & St. Joe Match West Bay Parkway", projectNumber: "10634", startDate: "08/2026", category: "Transportation & Public Works", fy2025: 0, fy2026: 5000000, phase: "Design", status: "In Progress", statusNote: "The latest work plan says the TRIP-funded design contract was executed in FY2025, with $5 million and a 50% developer-provided local match. Construction is not shown as underway. A separate action authorized a funding/match agreement with The St. Joe Company for a 50% ($2,500,000) local match of the FDOT grant toward design.", contracts: [
      { phase: "Design", contractor: "Mott MacDonald Florida, LLC", amount: "$4,693,502.38 (not-to-exceed)", date: "8/17/2026" }
    ], eng_color: "blue" },
    { name: "Country Boulevard (Dirt to Pave)", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2025: 24000, fy2026: 0, phase: "Construction", status: "Programmed", statusNote: "Appeared in an older county capital plan at the same $24,000 amount.", eng_color: "blue" },
    { name: "Grant CR 393 N Roadway & Pedestrian Improvements", projectNumber: "10220", estimatedCompletionDate: "2026", category: "Grant Funded", fy2025: 2494329.59, fy2026: 0, phase: "Construction", status: "In Progress", statusNote: "Estimated completion late summer 2026. Per County Engineering project notes (FY26, “CR 393N Rdwy & Drainage Improvements (US98 to Chat Holley)”): Construction phase, Grant Funded or Portion Thereof. A related FY25 permit-extension task (“CR 393 N ERP Permit Extension Package”) is tracked separately below. Amount per County finance system (Org 30047030, Project 10220), down from an earlier $3,893,728 estimate. Funded in part by a Resilient Florida Grant (FDEP).", contracts: [
      { phase: "Construction", contractor: "Gulf Coast Utility Contractors LLC", amount: "$3,505,165.25 (not-to-exceed)", date: "5/13/2025" },
      { phase: "CEI", contractor: "HDR", contractNumber: "Task Order No. 2507", amount: "$325,299", date: "5/13/2025" }
    ] },
    { name: "E. Mossyhead Main Street (Resurfacing)", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2025: 37500, fy2026: 0, phase: "Construction", status: "Programmed", statusNote: "Programmed resurfacing per the County Five-Year Work Plan; no Public Works completion report has been found yet to confirm construction is complete.", eng_color: "blue" },
    { name: "Josephene Street Paving", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2025: 92500, fy2026: 0, phase: "Construction", status: "Programmed", eng_color: "blue" },
    { name: "Moll Drive & US 98 Signalization Improvements", projectNumber: "10480", estimatedCompletionDate: "03/2026", category: "Transportation & Public Works", fy2025: 818639, fy2026: 0, phase: "Construction", status: "In Progress", statusNote: "Change Order No. 1 scheduled substantial completion for February 5, 2026 and final completion for March 7, 2026; a final reconciliation change order was approved in April 2026, but final acceptance has not yet been confirmed. Per County Engineering project notes (FY26, “US 98 & Church St/Moll Drive Intersection Improvements”): Construction phase.", contracts: [
      { phase: "Construction", contractor: "Murdock Investments, LLC d/b/a Griffin Traffic Signals", contractNumber: "ITB 24-42", amount: "$734,905.00", date: "12/19/2024" },
      { phase: "CEI", contractor: "Chipola Engineering Group (sub: Anchor Consulting Engineering & Inspection)", contractNumber: "Task Order ENG 25-02, under continuing services contract 22-014A", amount: "$77,654.24", date: "2/25/2025" }
    ] },
    { name: "Grant CR 1883 Improvements Projects Ph I", projectNumber: "10363", estimatedCompletionDate: "2026", category: "Grant Funded", fy2025: 3927081.99, fy2026: 0, phase: "Construction", status: "In Progress", statusNote: "Paving expected complete Q1 2026; closeout expected Q2 2026. Per County Engineering project notes (FY25, “CR 1883 Phase 1 Roadway Improvements”): Construction phase, Grant Funded or Portion Thereof (Design phase also recorded). Amount per County finance system (Org 10116001, Project 10363, “Grant County RD 1883 Phase 1”), vs. $3,074,103 on the FY2025 capital work plan. Funded through ARPA (Small County Outreach/Road Assistance Programs via FDOT); construction started Summer 2025 with a 190-day contract duration.", contracts: [
      { phase: "Construction", contractor: "Southeast Construction Co., LLC", amount: "$2,650,557.72", date: "not confirmed from public records" }
    ] },
    { name: "W Mossyhead Main Street (Resurfacing)", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2025: 58500, fy2026: 0, phase: "Construction", status: "Programmed", statusNote: "Originally programmed for FY2028 under the FY24-28 work plan, later moved up to FY2025 under the FY25-29 plan; no proof of construction completion has been found yet.", eng_color: "blue" },
    { name: "Royal Palm Avenue (Dirt to Pave)", projectNumber: "10481", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2025: 147000, fy2026: 0, phase: "Construction", status: "Programmed", statusNote: "Appeared in an older capital plan at the same $147,000 amount.", eng_color: "blue" },
    { name: "Cypress Avenue (Dirt to Pave)", projectNumber: "10477", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2025: 148500, fy2026: 0, phase: "Construction", status: "Programmed", statusNote: "The same project and $148,500 estimate appeared in older county capital plans, but no reliable completion or active-construction posting was found.", eng_color: "blue" },
    { name: "Silk Oak Dr (Dirt to Pave)", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2025: 18000, fy2026: 0, phase: "Construction", status: "Programmed", statusNote: "Appeared in an older county plan at the same $18,000 amount.", eng_color: "blue" },
    { name: "Hope Road Paving", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2025: 45000, fy2026: 0, phase: "Construction", status: "Programmed", eng_color: "blue" },
    { name: "Hermitage Road Paving", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2025: 46250, fy2026: 0, phase: "Construction", status: "Programmed", statusNote: "The approved FY2025 work plan categorized the $46,250 as construction/CEI funded through Public Works Maintenance, but that is a programmed phase rather than proof of completion.", eng_color: "blue" },
    { name: "Helen McCall Park Improvements Phase I Parking & Baseball Fields", projectNumber: "10194", estimatedCompletionDate: "Fall 2026", category: "Transportation & Public Works", fy2025: 8656732.75, fy2026: 0, phase: "Construction", status: "In Progress", statusNote: "The county places the expansion and parking improvements in the substantially complete/ongoing-efforts category. It also advertised a pre-bid conference for “Helen McCall Park Expansion Phase 1” on June 23, 2026, indicating movement toward construction procurement.", eng_color: "blue" },
    { name: "CR 280 Box Culvert / Bridge Replacement", projectNumber: "10468", startDate: "11/10/2025", category: "Transportation & Public Works", fy2025: 2570000, fy2026: 0, phase: "Design", status: "In Progress", statusNote: "The Public Works active-project table gives an actual start of November 10, 2025 for the design phase only — it does not establish that physical bridge/culvert construction has started. Amount per County finance system (Org 10116001, Project 10468), up from an earlier $700,000 estimate.", eng_color: "blue" },
    { name: "Juniper Avenue (Dirt to Pave)", projectNumber: "10479", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2025: 145500, fy2026: 0, phase: "Construction", status: "Programmed", statusNote: "Appeared in an older capital plan at the same $145,500 amount.", eng_color: "blue" },
    { name: "Cannon Drive Resurfacing", projectNumber: "7588", completedDate: "01/2026", category: "Transportation & Public Works", fy2025: 150442.70, fy2026: 0, phase: "Construction", status: "Complete", eng_color: "blue" },
    { name: "Cottonwood Boulevard (Dirt to Pave)", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2025: 37500, fy2026: 0, phase: "Construction", status: "Programmed", statusNote: "Appeared in an older county plan at the same $37,500 amount.", eng_color: "blue" },

    // -- Added from County Engineering's FY25/FY26 project-tracking
    // workbook; not previously on this ledger. Most have no dollar figure
    // in the workbook (see noBudgetYears note at top of file); several were
    // later updated with real amounts from the County's finance system.
    { name: "Karli Court Roadway & Drainage Improvements", completedDate: "07/20/2025", projectNumber: "10465", category: "Transportation & Public Works", fy2025: 162352.34, fy2026: 0, phase: "Construction", status: "Complete", statusNote: "In-House CEI. Amount per County finance system (Org 10116001, Project 10465).", eng_color: "red" },
    { name: "Mojo Building Renovation", projectNumber: "10060", completedDate: "03/2025", category: "Transportation & Public Works", fy2025: 1359945, fy2026: 0, phase: "Construction", status: "Complete", statusNote: "In-House CEI. $1,359,945 renovation budget." },
    { name: "Paradise Park Improvements (Restrooms)", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2025"], phase: "Construction", status: "In Progress", statusNote: "Design substantially complete; construction not yet complete. In-House CEI (Design/building-permit phase also recorded).", eng_color: "red" },
    { name: "SW Sports Complex Improvements", category: "Transportation & Public Works", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2025"], phase: "Construction", status: "Complete", statusNote: "In-House CEI.", eng_color: "red" },
    { name: "Bay Grove Road Drainage (Pointe Josie Rd to Outfall)", completedDate: "08/2026", category: "Transportation & Public Works", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2025"], phase: "Construction", status: "Complete", statusNote: "In-House CEI.", eng_color: "red" },
    { name: "Beaver Dam Pier", completedDate: "07/2026", category: "Transportation & Public Works", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2025"], phase: "Design & Construction", status: "Complete", statusNote: "In-House Design/Permitting.", eng_color: "red" },
    { name: "CR 83 S Resurfacing", completedDate: "05/20/2024", category: "Transportation & Public Works", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2025"], phase: "Design & Construction", status: "Complete", statusNote: "In-House Design/Permitting.", eng_color: "red" },
    { name: "CR 183 S Cross Drain Replacement", completedDate: "09/2025", category: "Transportation & Public Works", fy2025: 969267.60, fy2026: 0, phase: "Construction", status: "Complete", statusNote: "In-House CEI. $819,342.60 construction, plus up to $149,925 for prior engineering.", eng_color: "red" },
    { name: "CR 283 S Roadway Resurfacing Plans", completedDate: "2025", category: "Transportation & Public Works", fy2025: 275000, fy2026: 0, phase: "Design", status: "Complete", statusNote: "Design completed by FY2025; not yet under construction. $275,000 programmed.", eng_color: "red" },
    { name: "CR 393 N ERP Permit Extension Package", category: "Transportation & Public Works", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2025"], phase: "Permitting", status: "Complete", statusNote: "In-House Permitting.", eng_color: "red" },
    { name: "CR 883 Striping Plan", completedDate: "05/26/2025", category: "Transportation & Public Works", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2025"], phase: "Construction", status: "Complete", statusNote: "In-House Design/Permitting and In-House CEI (both phases recorded).", eng_color: "red" },
    { name: "Ed Walline Parking Lot Modifications/Beach Tram", completedDate: "2025", category: "Transportation & Public Works", fy2026: 0, noBudgetYears: ["FY2026"], phase: "Design", status: "Complete", statusNote: "Design completed Q4 2025; construction not yet complete.", eng_color: "red" },
    { name: "Eastern Lake Rd Drainage Improvements", category: "Transportation & Public Works", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2025"], phase: "Construction", status: "Complete", statusNote: "In-House Design/Permitting and In-House CEI (both phases recorded).", eng_color: "red" },
    { name: "Greenbriar Lane Drainage", completedDate: "06/02/2025", category: "Transportation & Public Works", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2025"], phase: "Construction", status: "Complete", statusNote: "In-House Design/Permitting and In-House CEI (both phases recorded).", eng_color: "red" },
    { name: "Holiday Shores Pedestrian Improvements Ph 1B", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2025: 931292, fy2026: 0, phase: "Construction", status: "In Progress", statusNote: "In-House CEI. $931,292 programmed. No verified completion date.", eng_color: "red" },
    { name: "Morrison Springs Entrance Adjustment for Attendant", category: "Transportation & Public Works", fy2025: 25000, fy2026: 0, phase: "Design & Construction", status: "Complete", statusNote: "In-House Design/Permitting. Up to $25,000.", eng_color: "red" },
    { name: "Parking Area at SR 20 Bridge over Choctawhatchee River", category: "Transportation & Public Works", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2025"], phase: "Preliminary Engineering", status: "Complete", statusNote: "In-House Design/Permitting.", eng_color: "red" },
    { name: "North Walton Multi-Use Trails (Phase 1 20th Street)", completedDate: "05/30/2025", category: "Grant Funded", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2025"], phase: "Construction", status: "Complete", statusNote: "Grant Funded or Portion Thereof.", eng_color: "red" },
    { name: "South Walton Dog Park Phase 1", completedDate: "2025", category: "Transportation & Public Works", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2025"], phase: "Construction", status: "Complete", statusNote: "In-House Design/Permitting and In-House CEI (both phases recorded).", eng_color: "red" },
    { name: "South Walton Multi-Use Trails (Mack Bayou Rd Phase 1)", completedDate: "12/2025", category: "Grant Funded", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2025"], phase: "Construction", status: "Complete", statusNote: "Grant Funded or Portion Thereof.", eng_color: "red" },
    { name: "South Walton Sports Complex Shade Structure (Bleachers)", completedDate: "2025", category: "Transportation & Public Works", fy2026: 0, noBudgetYears: ["FY2026"], phase: "Design & Construction", status: "Complete", statusNote: "In-House CEI (FY26).", eng_color: "red" },
    { name: "Teelinville Dam", completedDate: "2023", category: "Transportation & Public Works", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2025"], phase: "Design", status: "Complete", statusNote: "The County's Q4 2023 report lists this as a completed design project. In-House Design/Permitting. Teelinville Dam West is a related component currently under construction, not reflected in this design-only entry.", eng_color: "red" },
    { name: "Walton Sports Complex Outdoor Fitness Park", completedDate: "2025", category: "Transportation & Public Works", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2025"], phase: "Construction", status: "Complete", statusNote: "In-House Design/Permitting and In-House CEI (both phases recorded).", eng_color: "red" },
    { name: "Choctaw Beach Park Access Improvements/Guardrail Design & Agreement", completedDate: "10/2025", category: "Transportation & Public Works", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2026"], phase: "Construction", status: "Complete", statusNote: "In-House Design/Permitting and In-House CEI (both phases recorded).", eng_color: "red" },
    { name: "CR 30A Bike Path Improvements — Grayton Beach (Western Lake to Park Entrance)", category: "Transportation & Public Works", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2026"], phase: "Construction", status: "Complete", statusNote: "In-House Design/Permitting and In-House CEI (both phases recorded).", eng_color: "red" },
    { name: "CR 30A Bike Path Improvements — Deer Lake", category: "Transportation & Public Works", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2026"], phase: "Construction", status: "Complete", statusNote: "In-House Design/Permitting and In-House CEI (both phases recorded).", eng_color: "red" },
    { name: "CR 395 S Resurfacing", category: "Transportation & Public Works", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2026"], phase: "Construction", status: "Complete", statusNote: "In-House CEI.", eng_color: "red" },
    { name: "Driftwood Park Path & Basketball Court Rehab", category: "Transportation & Public Works", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2026"], phase: "Construction", status: "Complete", statusNote: "In-House Design/Permitting and In-House CEI (both phases recorded).", eng_color: "red" },
    { name: "Inlet Beach Pedestrian Tunnel Safety Countermeasures", completedDate: "2025", category: "Transportation & Public Works", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2026"], phase: "Design", status: "Complete", statusNote: "Design completed Q4 2025; construction not yet complete.", eng_color: "red" },
    { name: "Morrison Springs Boat & Kayak Launch Revisions Site Plan", category: "Transportation & Public Works", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2026"], phase: "Preliminary Engineering", status: "Complete", statusNote: "Conceptual/Design, In-House Design/Permitting.", eng_color: "red" },
    { name: "Seacrest (Pointe of View Condo) Bike Path & Drainage Improvements", category: "Transportation & Public Works", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2026"], phase: "Construction", status: "Complete", statusNote: "In-House Design/Permitting and In-House CEI (both phases recorded).", eng_color: "red" },
    { name: "South Walton Annex Shade Structure", startDate: "07/22/2025", category: "Transportation & Public Works", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2026"], phase: "Design & Construction", status: "In Progress", statusNote: "The Board approved purchase/installation for up to $100,000 on 7/22/2025; a completion date has not yet been verified. In-House Design/Permitting and In-House CEI (both phases recorded).", eng_color: "red" },
    { name: "Grant SR 20 & CR 83A W Intersection Signalization", completedDate: "08/2026", category: "Grant Funded", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2026"], phase: "Construction", status: "Complete", statusNote: "Grant Funded or Portion Thereof. Expanded project completed by August 2026.", eng_color: "red" },
    { name: "Stallworth Lake Cross Drain Rehabilitation", category: "Transportation & Public Works", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2026"], phase: "Construction", status: "Complete", statusNote: "In-House CEI.", eng_color: "red" },
    { name: "Walton Road Traffic Assessment for City of DeFuniak Springs", category: "Transportation & Public Works", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2026"], phase: "Report/Study", status: "Complete", statusNote: "In-House Design/Permitting.", eng_color: "red" },
    { name: "West Park Place Resurfacing", category: "Transportation & Public Works", fy2025: 0, fy2026: 0, noBudgetYears: ["FY2026"], phase: "Construction", status: "Complete", statusNote: "In-House Design/Permitting and In-House CEI (both phases recorded).", eng_color: "red" },

    // -- FY2024 budgeted projects, from the County's FY24-28 Five-Year Work
    // Plan (BCC adopted February 27, 2024). Every row on that plan carrying
    // a dollar amount in the FY2024 column is included below; the FY2024
    // column total on that plan is $33,259,700, which this set sums to
    // exactly as originally entered. Later corrections may remove or revise
    // individual FY2024 amounts. Not cross-checked against a
    // completion workbook the way FY2025/FY2026 were above, so status is
    // "Programmed" rather than a verified Complete/In Progress.
    { name: "Grant Allen Loop Roadway & Drainage Improvements", projectNumber: "10457", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2024: 1599755, phase: "Construction", status: "In Progress", statusNote: "Per the FY24-28 work plan (adopted February 27, 2024): $1,599,755 budgeted for FY2024 construction/CEI, funded by Restore Act funds; the plan notes this funding was pending grant approval. In progress." },
    { name: "Carolyn Lane Resurfacing", projectNumber: "13533", completedDate: "10/07/2024", category: "Transportation & Public Works", fy2024: 15047.92, phase: "Construction", status: "Complete", statusNote: "Per the FY24-28 work plan (adopted February 27, 2024): $15,047.92 budgeted for FY2024 construction/CEI, funded by PW Maintenance (In-House; materials only). Complete." },
    { name: "CR 2 Over Long Creek Bridge", projectNumber: "10128", completedDate: "09/2024", category: "Transportation & Public Works", fy2024: 481816.98, phase: "Design & Construction", status: "Complete", statusNote: "Per the FY24-28 work plan (adopted February 27, 2024): $481,816.98 budgeted for FY2024 design and construction/CEI (BSCOP & PW Capital). Complete." },
    { name: "CR 83A Bear Creek Bridge", projectNumber: "10110", completedDate: "06/2024", category: "Transportation & Public Works", fy2024: 982230, phase: "Construction", status: "Complete", statusNote: "Per the FY24-28 work plan (adopted February 27, 2024): $982,230 budgeted for FY2024 construction/CEI, funded by a legislative appropriation, the City of Freeport, and capital funds. Complete." },
    { name: "CR 83A W (West Bay Loop) Northbound Right Turn Lane", completedDate: "08/2026", category: "Transportation & Public Works", fy2024: 300000, phase: "Design & Construction", status: "Complete", statusNote: "Per the FY24-28 work plan (adopted February 27, 2024): $30,000 budgeted for FY2024 design and $270,000 for FY2024 construction/CEI (In-House; materials only), both funded by PW Capital. Expanded project completed by August 2026." },
    { name: "Grant CR 280 Bob Sikes Roadway Resurfacing Project", projectNumber: "10367", estimatedStartDate: "2027", category: "Transportation & Public Works", fy2024: 663537, phase: "Design & Construction", status: "In Progress", statusNote: "Per the FY24-28 work plan (adopted February 27, 2024): $663,537 budgeted for FY2024 design, funded by FDOT's Small County Outreach Program (SCOP). Construction expected to start in 2027. The FDOT grant agreement was approved September 11, 2023; the design RFQ was awarded November 28, 2023; and the design contract was approved and executed February 27, 2024.", contracts: [
      { label: "Grant Agreement", contractor: "Florida Department of Transportation (FDOT)", amount: "Approximately $663,537.73 after Supplemental Agreement No. 1", date: "09/11/2023", contractNumber: "FPN 451780-1-34-01 / SCOP Agreement G2N55", note: "State-Funded Grant Agreement for the CR 280/Bob Sikes Road Resurfacing Project. Supplemental Agreement No. 1 added $22,710 in grant funding on May 26, 2026." },
      { phase: "Design Engineering", contractor: "Chipola Engineering Group, Inc.", amount: "Up to $640,827.73", date: "02/27/2024", contractNumber: "Contract No. 23-35 / RFQ 23-35", note: "Design services funded through FDOT SCOP." }
    ], timeline: [
      { date: "September 11, 2023", text: "Walton County approved the FDOT State-Funded Grant Agreement, FPN 451780-1-34-01, for the CR 280/Bob Sikes Road Resurfacing Project and authorized solicitation of design services." },
      { date: "November 28, 2023", text: "Walton County awarded RFQ 23-35 for design engineering services to Chipola Engineering Group, Inc., the top-ranked firm, and authorized contract negotiations." },
      { date: "February 27, 2024", text: "The Board approved and authorized Design Engineering Services Contract No. 23-35 with Chipola Engineering Group for up to $640,827.73, funded through FDOT SCOP." },
      { date: "May 26, 2026", text: "The County approved Supplemental Agreement No. 1 to SCOP Agreement G2N55, adding $22,710 in grant funding associated with the project." }
    ] },
    { name: "CR 283 S Resurfacing", projectNumber: "17009", completedDate: "03/03/2025", category: "Transportation & Public Works", fy2024: 261378.52, phase: "Construction", status: "Complete", statusNote: "Per the FY24-28 work plan (adopted February 27, 2024): $261,378.52 budgeted for FY2024 construction/CEI, funded by PW Maintenance (In-House; materials only). Complete." },
    { name: "CR 395 Roadway & Pedestrian Improvements (US 98 to Bay)", projectNumber: "10217", startDate: "03/2026", category: "Transportation & Public Works", fy2024: 4199330.81, phase: "Construction", status: "In Progress", statusNote: "Per the FY24-28 work plan (adopted February 27, 2024): $4,199,330.81 budgeted for FY2024 construction/CEI, funded by FY24 SWIF. In progress.", contracts: [
      { phase: "Construction", contractor: "Roberts & Roberts Inc.", contractNumber: "ITB ENG25-23, low bid", amount: "$3,001,789.80", date: "11/24/2025" },
      { phase: "CEI", contractor: "not confirmed from public records", contractNumber: "Task Order ENG25-11", amount: "$307,180", date: "11/24/2025" }
    ] },
    { name: "CR 883 (Business 331) Sidewalks Phase I", projectNumber: "10337", completedDate: "08/2024", category: "Transportation & Public Works", fy2024: 421205, phase: "Construction", status: "Complete", statusNote: "Per the FY24-28 work plan (adopted February 27, 2024): $421,205 budgeted for FY2024 construction/CEI, funded by SRTS-LAP. Complete." },
    { name: "Hewett Bayou Connector (E. Lamb Drive Extension)", projectNumber: "10274", completedDate: "09/2025", category: "Transportation & Public Works", fy2024: 695095, phase: "Design", status: "Complete", statusNote: "Per the FY24-28 work plan (adopted February 27, 2024): $695,095 budgeted for FY2024 design, funded by CIGP. Complete." },
    { name: "Huckaba Road Paving", completedDate: "07/31/2024", projectNumber: "7859", category: "Transportation & Public Works", fy2024: 46818.58, phase: "Construction", status: "Complete", statusNote: "Per the FY24-28 work plan (adopted February 27, 2024): $46,818.58 budgeted for FY2024 construction/CEI (In-House; materials only), funded by PW Maintenance. Complete." },
    { name: "Mack Bayou Roadway & Pedestrian Improvements", projectNumber: "10170", completedDate: "12/2025", category: "Transportation & Public Works", fy2024: 989720, phase: "Design & Construction", status: "Complete", statusNote: "Per the FY24-28 work plan (adopted February 27, 2024): $989,720 budgeted for FY2024 design (Phase 1), funded by PW Capital FY22/23 and a legislative appropriation. Substantial construction complete December 2025." },
    { name: "Mack Bayou/Sandestin Ln Connector Rd", projectNumber: "10470", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2024: 370000, phase: "Design", status: "In Progress", statusNote: "Per the FY24-28 work plan (adopted February 27, 2024): $370,000 budgeted for FY2024 design, funded by PFS/Mobility Fee. Still listed under active design. Construction/CEI (est. $2.2 million per the current work plan) had not yet been awarded as of the latest available records; right-of-way acquisition was still pending.", contracts: [
      { phase: "Design", contractor: "Hanson Professional Services, Inc.", contractNumber: "Task Order ENG 25-03", amount: "$368,214.17", date: "3/25/2025" }
    ] },
    { name: "Madge Lane & Sally Lane Roadway & Drainage Improvements", projectNumber: "10471", completedDate: "07/2025", category: "Transportation & Public Works", fy2024: 184475, phase: "Design", status: "Complete", statusNote: "Per the FY24-28 work plan (adopted February 27, 2024): $184,475 budgeted for FY2024 design, funded by PW Capital. Design complete." },
    { name: "Mathews Road Reconstruction Project", completedDate: "05/20/2025", projectNumber: "7593", category: "Transportation & Public Works", fy2024: 337400, phase: "Construction", status: "Complete", statusNote: "Per the FY24-28 work plan (adopted February 27, 2024): $337,400 budgeted for FY2024 construction/CEI (In-House; materials only), funded by PW Maintenance. Complete." },
    { name: "Natural Bridge Roadway and Drainage Improvement", completedDate: "07/29/2024", projectNumber: "8052", category: "Transportation & Public Works", fy2024: 54238.98, phase: "Construction", status: "Complete", statusNote: "Per the FY24-28 work plan (adopted February 27, 2024): $54,238.98 budgeted for FY2024 construction/CEI (In-House; materials only), funded by PW Maintenance. Complete." },
    { name: "North End Multi-Use Trail & Pedestrian Path", projectNumber: "10289", category: "Transportation & Public Works", fy2024: 800000, phase: "Design & Construction", status: "Complete", statusNote: "Per the FY24-28 work plan (adopted February 27, 2024): $166,180 budgeted for FY2024 design and $633,820 for FY2024 construction/CEI, both funded by a legislative appropriation. Covers the plan's Phase 1 (20th Street); remaining phases were noted as the City of DeFuniak Springs' to pursue funding for. The County entered FDOT Grant Agreement FPN 450942-1-54-01 on 8/23/2022 for design, construction, and CEI. Complete." },
    { name: "Pisces Drive Resurfacing", completedDate: "10/07/2024", category: "Transportation & Public Works", fy2024: 75000, phase: "Construction", status: "Complete", statusNote: "Per the FY24-28 work plan (adopted February 27, 2024): $75,000 budgeted for FY2024 construction/CEI (In-House; materials only), funded by PW Maintenance. Complete." },
    { name: "Renoir Court (Dirt to Pave)", completedDate: "07/08/2024", category: "Transportation & Public Works", fy2024: 20000, phase: "Construction", status: "Complete", statusNote: "Per the FY24-28 work plan (adopted February 27, 2024): $20,000 budgeted for FY2024 construction/CEI (In-House; materials only), funded by PW Capital. Complete." },
    { name: "Grant Rock Hill Rd Improvements (Phase I - US 331 to High Lonesome Rd)", completedDate: "10/2024", category: "Grant Funded", fy2024: 4641123.10, phase: "Design & Construction", status: "Complete", statusNote: "Per the FY24-28 work plan (adopted February 27, 2024): $4,641,123.10 budgeted for FY2024 design and construction/CEI (Phase I only), funded by FDOT ARPA Funds. Phase I complete." },

    // -- FY2023 budgeted projects, from the County's "FY 22/23 Walton County
    // Public Works Capital Projects" list and "FY 22/23 South Walton County
    // Infrastructure Fund Capital Projects" list (both Public Works Director
    // approved). The Public Works list totals $3,097,940 and the South
    // Walton Infrastructure Fund list totals $4,000,000 -- this set sums to
    // their combined total as originally entered. Later corrections may
    // remove or revise individual FY2023 amounts. Not cross-checked
    // against a completion workbook, so status is "Programmed" rather than
    // a verified Complete/In Progress, except where later years' entries
    // above already confirm completion.
    { name: "Indian Creek Ranch Road Bridge Replacement", projectNumber: "10089", completedDate: "09/2023", category: "Transportation & Public Works", fy2023: 756534.41, phase: "Construction", status: "Complete", statusNote: "Per the FY22/23 Walton County Public Works Capital Projects list: $756,534.41 budgeted for FY2023 construction/CEI, outsourced (Bridge# 604004, supplemental funds for construction, 2.06 miles east of US Hwy 331). Complete." },
    { name: "Summer Lake Outfall Phase 1", projectNumber: "10198", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2026: 320000, phase: "Design", status: "Programmed", statusNote: "Per the County's FY2026 Capital Project Fund List general ledger (Org 30047000, Object 563000, Project 10198): $320,000 FY2026 budget for design & engineering." },
    { name: "East Point Washington Road Connector Phase III", projectNumber: "10192", completedDate: "04/2024", category: "Transportation & Public Works", fy2023: 1431239.87, phase: "Construction", status: "Complete", statusNote: "Per the FY22/23 South Walton County Infrastructure Fund Capital Projects list: $1,431,239.87 budgeted for FY2023 construction, outsourced. Complete." },
    { name: "Deer Lake Bridge (Coastal Dune Lake Hydrologic Restoration)", projectNumber: "10230", completedDate: "06/2024", category: "Transportation & Public Works", fy2023: 337311.28, phase: "Construction", status: "Complete", statusNote: "Per the FY22/23 South Walton County Infrastructure Fund Capital Projects list: $337,311.28 budgeted for FY2023 construction (combined construction and CEI), outsourced. Complete." },
    { name: "West Heather Ave (Dirt to Pave)", projectNumber: "101402", completedDate: "06/2023", category: "Transportation & Public Works", fy2023: 14075, phase: "Construction", status: "Complete", statusNote: "Per the FY22/23 Walton County Public Works Capital Projects list: $14,075 budgeted for FY2023 construction (In-House), Walden Road to end of maintenance, 0.06 miles. Complete." },
    { name: "Orange Blossom Avenue (Dirt to Pave)", projectNumber: "10306", startDate: "02/2026", category: "Transportation & Public Works", fy2026: 73830, phase: "Construction", status: "In Progress", statusNote: "$73,830 moved from FY2023 to FY2026 for construction (In-House), Brookside Drive to end of maintenance, 0.35 miles." },
    { name: "Pointsetta Ave (Dirt to Pave)", projectNumber: "10307", startDate: "03/2026", category: "Transportation & Public Works", fy2026: 69732, phase: "Construction", status: "In Progress", statusNote: "$69,732 is budgeted for FY2026 construction (In-House), Brookside Drive to end of maintenance, 0.32 miles. Currently in progress." },
    { name: "Oleander Avenue (Dirt to Pave)", completedDate: "07/30/2024", projectNumber: "10308", category: "Transportation & Public Works", fy2023: 82930.83, phase: "Construction", status: "Complete", statusNote: "Per the FY22/23 Walton County Public Works Capital Projects list: $82,930.83 budgeted for FY2023 construction (In-House), Brookside Drive to end of maintenance, 0.39 miles. Complete." },
    { name: "Larkspur Avenue (Dirt to Pave)", projectNumber: "14766", completedDate: "07/30/2024", category: "Transportation & Public Works", fy2023: 168986.25, phase: "Construction", status: "Complete", statusNote: "Per the FY22/23 Walton County Public Works Capital Projects list: $168,986.25 budgeted for FY2023 construction (In-House), Brookside Drive to end of maintenance, 0.52 miles. Complete." },
    { name: "Harrison Road (Dirt to Pave)", completedDate: "03/03/2025", projectNumber: "10310", category: "Transportation & Public Works", fy2023: 387875.43, phase: "Construction", status: "Complete", statusNote: "Per the FY22/23 Walton County Public Works Capital Projects list: $387,875.43 budgeted for FY2023 construction (In-House), end of pavement to Co Hwy 2, 1.59 miles. Complete." },
    { name: "WC Currington Road (Milled Asphalt Road Improvements)", projectNumber: "12022", completedDate: "07/2023", category: "Transportation & Public Works", fy2023: 210720, phase: "Construction", status: "Complete", statusNote: "Per the FY22/23 Walton County Public Works Capital Projects list: $210,720 budgeted for FY2023 construction (In-House), White Creek Road to CR 183, 2.55 miles. Complete." },
    { name: "McHenry Road (Milled Asphalt Road Improvements)", projectNumber: "100861", completedDate: "05/2023", category: "Transportation & Public Works", fy2023: 153479.18, phase: "Construction", status: "Complete", statusNote: "Per the FY22/23 Walton County Public Works Capital Projects list: $153,479.18 budgeted for FY2023 construction (In-House), WC Currington Road to CR 183, 1.22 miles. Complete." },
    { name: "Mack Bayou Road Resurfacing", completedDate: "12/2025", category: "Transportation & Public Works", fy2023: 489720, phase: "Construction", status: "Complete", statusNote: "Per the FY22/23 Walton County Public Works Capital Projects list: $489,720 budgeted for FY2023 resurfacing (In-House), Hwy 98 to E&W Harborview Road, 2.24 miles. Substantial construction complete December 2025." },
    { name: "Williams Road Resurfacing", completedDate: "10/22/2025", category: "Transportation & Public Works", fy2023: 350697, phase: "Construction", status: "Complete", statusNote: "Per the FY22/23 Walton County Public Works Capital Projects list: $350,697 budgeted for FY2023 resurfacing (In-House), Hwy 331 to Turkey Creek Pit Road, 2.89 miles. Complete." },
    { name: "Blue Pond Circle Resurfacing", projectNumber: "200111", completedDate: "05/2023", category: "Transportation & Public Works", fy2023: 28379.63, phase: "Construction", status: "Complete", statusNote: "Per the FY22/23 Walton County Public Works Capital Projects list: $28,379.63 budgeted for FY2023 resurfacing (In-House), Holmes County Line to end of pavement, 0.77 miles. Complete." },
    { name: "County Highway 83 South Resurfacing", completedDate: "05/2024", category: "Transportation & Public Works", fy2023: 435600, phase: "Construction", status: "Complete", statusNote: "Per the FY22/23 Walton County Public Works Capital Projects list: $435,600 budgeted for FY2023 resurfacing (In-House), CR30A to US Hwy 98, 2.2 miles. Complete." },
    { name: "Adams Street Resurfacing", projectNumber: "12664", completedDate: "09/2023", category: "Transportation & Public Works", fy2023: 95708.54, phase: "Construction", status: "Complete", statusNote: "Per the FY22/23 Walton County Public Works Capital Projects list: $95,708.54 budgeted for FY2023 resurfacing (In-House), Clear Springs Road to CR 147, 1 mile. Complete." },

    // -- FY2022 budgeted projects, from the County's "FY 21/22 Walton County
    // Public Works Capital Projects" list ($2,352,721 total) and "Fiscal
    // Year 21/22 South Walton TIF Capital Projects" list ($4,000,000
    // total), combined $6,352,721. Kept as standalone entries rather than
    // merged into later-year projects of similar name (e.g. Holiday Shores
    // Drainage & Pedestrian Improvements PH I/PH II, Helen McCall Park)
    // since the FY2022 source doesn't confirm they're the same funded
    // phase. Multi-line items (construction + CEI on the same project) are
    // combined into one entry. FY2022 is now several years past, so these
    // are marked Complete like the rest of this historical repository.
    { name: "Primrose Avenue (Dirt to Pave)", projectNumber: "10129", startDate: "08/2026", category: "Transportation & Public Works", fy2026: 60643, phase: "Construction", status: "In Progress", statusNote: "$60,643 moved from FY2022 to FY2026 for construction, Brookside Drive to end of maintenance, 0.35 miles." },
    { name: "Jonquil Avenue (Dirt to Pave)", projectNumber: "10130", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2026: 62367, phase: "Construction", status: "Programmed", statusNote: "$62,367 moved from FY2022 to FY2026 for construction, Brookside Drive to end of maintenance, 0.37 miles. Start date TBD." },
    { name: "Cornflower Avenue (Dirt to Pave)", projectNumber: "10131", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2026: 49602, phase: "Construction", status: "Programmed", statusNote: "$49,602 moved from FY2022 to FY2026 for construction, Brookside Drive to end of maintenance, 0.29 miles. Start date TBD." },
    { name: "Hyacinth Avenue (Dirt to Pave)", projectNumber: "10132", estimatedStartDate: "TBD", category: "Transportation & Public Works", fy2026: 57578, phase: "Construction", status: "Programmed", statusNote: "$57,578 moved from FY2022 to FY2026 for construction, Brookside Drive to end of maintenance, 0.34 miles. Start date TBD." },
    { name: "Beaver Dam Road (Dirt to Pave)", projectNumber: "10133", completedDate: "07/12/2023", category: "Transportation & Public Works", fy2022: 91556, phase: "Construction", status: "Complete", statusNote: "Per the FY 21/22 Walton County Public Works Capital Projects list: $91,556 budgeted for FY2022 construction, Trout Drive to end of maintenance, 0.42 miles." },
    { name: "Roman Road (Dirt to Pave)", projectNumber: "10134", completedDate: "01/2024", category: "Transportation & Public Works", fy2022: 99450.24, phase: "Construction", status: "Complete", statusNote: "Per the FY 21/22 Walton County Public Works Capital Projects list: $99,450.24 budgeted for FY2022 construction, Trout Drive to end of maintenance, 0.31 miles." },
    { name: "Waterside Lane (Dirt to Pave)", projectNumber: "101473", completedDate: "02/2024", category: "Transportation & Public Works", fy2022: 31430.11, phase: "Construction", status: "Complete", statusNote: "Per the FY 21/22 Walton County Public Works Capital Projects list: $31,430.11 budgeted for FY2022 construction, Hwy 331 to end of maintenance, 0.23 miles." },
    { name: "Old Seagrove Beach Roadway and Stormwater Improvements", projectNumber: "10136", completedDate: "05/2023", category: "Transportation & Public Works", fy2022: 98702.10, phase: "Design", status: "Complete", statusNote: "Per the FY 21/22 Walton County Public Works Capital Projects list: $98,702.10 budgeted for FY2022 design & permitting, north of 30A from Dogwood Street to Gardenia Street." },
    { name: "Chesser Road Bridge", projectNumber: "10099", completedDate: "09/2022", category: "Transportation & Public Works", fy2022: 333965, phase: "Construction", status: "Complete", statusNote: "Per the FY 21/22 Walton County Public Works Capital Projects list: $333,965 budgeted for FY2022 construction, .67 miles east of Pleasant Ridge Road." },
    { name: "Aplin Road (Milled Asphalt Road Improvements)", projectNumber: "11175", completedDate: "03/29/2023", category: "Transportation & Public Works", fy2022: 195686.56, phase: "Construction", status: "Complete", statusNote: "Per the FY 21/22 Walton County Public Works Capital Projects list: $195,686.56 budgeted for FY2022 construction, East Tedder Road to Sandy Ramp Road, 2.1 miles." },
    { name: "Sandy Ramp Road (Milled Asphalt Road Improvements)", projectNumber: "7882", completedDate: "03/2023", category: "Transportation & Public Works", fy2022: 51979.50, phase: "Construction", status: "Complete", statusNote: "Per the FY 21/22 Walton County Public Works Capital Projects list: $51,979.50 budgeted for FY2022 construction, CR 0605 to Alabama State Line, 2.87 miles." },
    { name: "Davis Road (Milled Asphalt Road Improvements)", projectNumber: "11246", completedDate: "07/2023", category: "Transportation & Public Works", fy2022: 194151.13, phase: "Construction", status: "Complete", statusNote: "Per the FY 21/22 Walton County Public Works Capital Projects list: $194,151.13 budgeted for FY2022 construction, CR 0605 to end of maintenance, 2.36 miles." },
    { name: "George Montgomery Road (Paving)", projectNumber: "18593", completedDate: "01/2026", category: "Transportation & Public Works", fy2022: 480237.63, phase: "Construction", status: "Complete", statusNote: "Per the FY 21/22 Walton County Public Works Capital Projects list: $480,237.63 budgeted for FY2022 construction, end of pavement to CR 183S, 1.04 miles." },
    { name: "Sherwood Road (Milled Asphalt Road Improvements)", projectNumber: "7888", completedDate: "02/2024", category: "Transportation & Public Works", fy2022: 80317.59, phase: "Construction", status: "Complete", statusNote: "Per the FY 21/22 Walton County Public Works Capital Projects list: $80,317.59 budgeted for FY2022 construction, end of pavement to Red Hill Road, 1.77 miles." },
    { name: "Red Hill Road (Milled Asphalt Road Improvements)", projectNumber: "9964", completedDate: "10/2022", category: "Transportation & Public Works", fy2022: 190406.59, phase: "Construction", status: "Complete", statusNote: "Per the FY 21/22 Walton County Public Works Capital Projects list: $190,406.59 budgeted for FY2022 construction, end of pavement to Sherwood Road, 2.1 miles." },
    { name: "Beatrice Point Road (Milled Asphalt Road Improvements)", projectNumber: "8264", completedDate: "09/13/2022", category: "Transportation & Public Works", fy2022: 46550.97, phase: "Construction", status: "Complete", statusNote: "Per the FY 21/22 Walton County Public Works Capital Projects list: $46,550.97 budgeted for FY2022 construction, Bayloop Road to end of maintenance, 0.59 miles." },
    { name: "Red Barn Road (Milled Asphalt Road Improvements)", projectNumber: "8267", completedDate: "09/2022", category: "Transportation & Public Works", fy2022: 39534.64, phase: "Construction", status: "Complete", statusNote: "Per the FY 21/22 Walton County Public Works Capital Projects list: $39,534.64 budgeted for FY2022 construction, Bayloop Road to end of maintenance, 0.51 miles." },
    { name: "Strickland Road (Milled Asphalt Road Improvements)", projectNumber: "9804", completedDate: "09/2022", category: "Transportation & Public Works", fy2022: 37623.84, phase: "Construction", status: "Complete", statusNote: "Per the FY 21/22 Walton County Public Works Capital Projects list: $37,623.84 budgeted for FY2022 construction, Bob Sikes to end of maintenance, 0.4 miles." },
    { name: "Henderson Drive (Milled Asphalt Road Improvements)", projectNumber: "9788", completedDate: "09/2022", category: "Transportation & Public Works", fy2022: 26549.09, phase: "Construction", status: "Complete", statusNote: "Per the FY 21/22 Walton County Public Works Capital Projects list: $26,549.09 budgeted for FY2022 construction, Bob Sikes to end of maintenance, 0.24 miles." },
    { name: "Alma Road (Milled Asphalt Road Improvements)", projectNumber: "7695", completedDate: "09/13/2022", category: "Transportation & Public Works", fy2022: 62308.30, phase: "Construction", status: "Complete", statusNote: "Per the FY 21/22 Walton County Public Works Capital Projects list: $62,308.30 budgeted for FY2022 construction, Thad Bell to end of maintenance, 0.96 miles." },
    { name: "Thad Bell Road PH1 (Milled Asphalt Road Improvements)", projectNumber: "101330", completedDate: "10/2022", category: "Transportation & Public Works", fy2022: 105725.13, phase: "Construction", status: "Complete", statusNote: "Per the FY 21/22 Walton County Public Works Capital Projects list: $105,725.13 budgeted for FY2022 construction, Hwy 83 approximately 2.0 miles to the west, 2 miles." },
    { name: "Indian Creek Ranch Road PH3 (Milled Asphalt Road Improvements)", projectNumber: "10089", completedDate: "09/2024", category: "Transportation & Public Works", fy2022: 756534.41, phase: "Construction", status: "Complete", statusNote: "Per the FY 21/22 Walton County Public Works Capital Projects list: $756,534.41 budgeted for FY2022 construction, Bruce Creek Bridge to Phase 1 limits, 0.5 miles." },
    { name: "Happy Hollow Road Resurfacing", projectNumber: "7549", completedDate: "09/2022", category: "Transportation & Public Works", fy2022: 57492.51, phase: "Construction", status: "Complete", statusNote: "Per the FY 21/22 Walton County Public Works Capital Projects list: $57,492.51 budgeted for FY2022 resurfacing, Hwy 3280 to Creekview Avenue, 0.38 miles." },
    { name: "Creekview Avenue Resurfacing", projectNumber: "7558", completedDate: "09/2022", category: "Transportation & Public Works", fy2022: 31214.06, phase: "Construction", status: "Complete", statusNote: "Per the FY 21/22 Walton County Public Works Capital Projects list: $31,214.06 budgeted for FY2022 resurfacing, Happy Hollow Road to end of maintenance, 0.2 miles." },
    { name: "Peach Creek Pedestrian Improvements", projectNumber: "10137", completedDate: "01/2023", category: "Transportation & Public Works", fy2022: 71079.20, phase: "Construction", status: "Complete", statusNote: "Per the FY 21/22 Walton County Public Works Capital Projects list: $71,079.20 budgeted for FY2022 sidewalks, Old Ferry Road and Coochee Road." },
    { name: "Holiday Shores Drainage & Pedestrian Improvements PH II", projectNumber: "10225", estimatedCompletionDate: "2027", category: "Transportation & Public Works", fy2022: 200000, phase: "Design", status: "In Progress", statusNote: "$200,000 budgeted for design & engineering, estimated completion 2027." },
    { name: "Helen McCall Park Parking Lot Expansion", projectNumber: "10241", completedDate: "09/2022", category: "Transportation & Public Works", fy2022: 107425, phase: "Design", status: "Complete", statusNote: "Per the Fiscal Year 21/22 South Walton TIF Capital Projects list: $107,425 budgeted for FY2022 design & engineering." },
    { name: "CR 283 North Multi Use Path", projectNumber: "10090", completedDate: "05/2022", category: "Transportation & Public Works", fy2022: 525094.26, phase: "Construction", status: "Complete", statusNote: "RBM Contracting Services was awarded Contract 021-025 for $525,094.26 on 10/26/2021 for FY2022 construction (combined construction and CEI)." },
    { name: "North Spooky Lane Roadway & Drainage Improvements", projectNumber: "10242", completedDate: "09/2023", category: "Transportation & Public Works", fy2022: 248687, phase: "Construction", status: "Complete", statusNote: "Per the Fiscal Year 21/22 South Walton TIF Capital Projects list: $248,687 budgeted for FY2022 construction (combined construction and CEI)." },
    { name: "Holiday Shores Drainage & Pedestrian Improvements PH IA", projectNumber: "10225", completedDate: "2025", category: "Transportation & Public Works", fy2022: 1400000, phase: "Construction", status: "Complete", statusNote: "Per the Fiscal Year 21/22 South Walton TIF Capital Projects list: $1,400,000 budgeted for FY2022 construction." },
    { name: "San Juan Avenue Cross Drain Upgrade", projectNumber: "10243", completedDate: "03/2023", category: "Transportation & Public Works", fy2022: 895065.42, phase: "Construction", status: "Complete", statusNote: "Per the Fiscal Year 21/22 South Walton TIF Capital Projects list: $895,065.42 budgeted for FY2022 construction (combined construction and CEI)." },

    // -- Found on the County's FY2026 general ledger (Transportation Fund
    // Projects and Capital Project Fund List, pulled 08/19/2026) but not
    // previously on this historical repository -- added here from those
    // ledgers' "2026 Revised Budget" column and flagged (red project title)
    // for review, since they haven't been cross-checked against a work plan
    // or completion source the way the rest of this file has.
    { name: "Pavement Condition Index Study", projectNumber: "10138", orgCode: "10116001", completedDate: "01/2026", category: "Transportation & Public Works", fy2026: 270636.65, phase: "Report/Study", status: "Complete", flagged: false, statusNote: "Per the County's FY2026 Transportation Fund Projects general ledger (Org 10116001, Object 531000, Project 10138): $270,636.65 FY2026 revised budget. Complete." },
    { name: "Fleet Building Repairs", projectNumber: "10663", orgCode: "10116001", startDate: "08/2025", category: "Transportation & Public Works", fy2026: 69263.27, phase: "Construction", status: "In Progress", flagged: true, statusNote: "Per the County's FY2026 Transportation Fund Projects general ledger (Org 10116001, Object 562000, Project 10663): $69,263.27 FY2026 revised budget. Not previously listed on this ledger — flagged for review." },
    { name: "Northwest Commerce Crossing", projectNumber: "10696", estimatedStartDate: "TBD", orgCode: "10116001", category: "Transportation & Public Works", fy2026: 500000, phase: "Construction", status: "Programmed", flagged: true, statusNote: "Per the County's FY2026 Transportation Fund Projects general ledger (Org 10116001, Object 563000, Project 10696): $500,000 FY2026 revised budget. Not previously listed on this ledger — flagged for review." },
    { name: "Old Ferry Road", projectNumber: "10752", estimatedStartDate: "TBD", orgCode: "10116001", category: "Transportation & Public Works", fy2026: 35000, phase: "Construction", status: "Programmed", flagged: true, statusNote: "Per the County's FY2026 Transportation Fund Projects general ledger (Org 10116001, Object 563000, Project 10752): $35,000 FY2026 revised budget. Not previously listed on this ledger — flagged for review." },
    { name: "Low Speed Vehicle Pull Over Area", projectNumber: "10352", orgCode: "10116001", completedDate: "04/2026", category: "Transportation & Public Works", fy2026: 62674.97, phase: "Construction", status: "Complete", flagged: true, statusNote: "The County's April 28, 2026 Engineering report lists the 30A Low Speed Vehicle Pull Over Areas under Completed Construction. Per the County's FY2026 Transportation Fund Projects general ledger (Org 10116001, Object 563000, Project 10352): $62,674.97 FY2026 revised budget. Not previously listed on this ledger — flagged for review." },
    { name: "Driftwood Road Traffic Signal", projectNumber: "10100", orgCode: "10116001", startDate: "06/2025", category: "Transportation & Public Works", fy2026: 390852.34, phase: "Design", status: "In Progress", flagged: true, statusNote: "Design started June 2025. Per the County's FY2026 Transportation Fund Projects general ledger (Org 10116001, Object 563000, Project 10100): $390,852.34 FY2026 revised budget. Not previously listed on this ledger — flagged for review." },
    { name: "Paxton Senior Center", projectNumber: "10644", orgCode: "10116001", startDate: "06/2026", category: "Transportation & Public Works", fy2026: 243024.65, phase: "Construction", status: "In Progress", flagged: true, statusNote: "The County's August 2026 Public Works update reports crews doing asphalt paving of the parking lot and striping, consistent with the June 2026 start. Per the County's FY2026 Transportation Fund Projects general ledger (Org 10116001, Object 534000, Project 10644): $243,024.65 FY2026 revised budget. Not previously listed on this ledger — flagged for review." },
    { name: "River Road Bridge Replacement", projectNumber: "10093", estimatedStartDate: "TBD", orgCode: "10116001", category: "Transportation & Public Works", fy2026: 423354.67, phase: "Construction", status: "Programmed", flagged: true, statusNote: "Per the County's FY2026 Transportation Fund Projects general ledger (Org 10116001, Object 563000, Project 10093): $423,354.67 FY2026 revised budget. Not previously listed on this ledger — flagged for review." },
    { name: "Mossyhead Waste Treatment Project", projectNumber: "10641", estimatedStartDate: "TBD", orgCode: "10116020", category: "Transportation & Public Works", fy2026: 891000, phase: "Construction", status: "Programmed", flagged: true, statusNote: "Per the County's FY2026 Transportation Fund Projects general ledger (Org 10116020, Object 563000, Project 10641): $891,000 FY2026 revised budget. Not previously listed on this ledger — flagged for review." },
    { name: "CR 393 Scenic Group Grant Match", projectNumber: "10359", estimatedStartDate: "TBD", orgCode: "10116001", category: "Transportation & Public Works", fy2026: 1000000, phase: "Construction", status: "Programmed", flagged: true, statusNote: "Per the County's FY2026 Transportation Fund Projects general ledger (Org 10116001, Object 563000, Project 10359): $1,000,000 FY2026 revised budget. Not previously listed on this ledger — flagged for review." },
    { name: "Mack Bayou Path Phase II", projectNumber: "10722", orgCode: "30047030", startDate: "04/2026", category: "Transportation & Public Works", fy2026: 107069.80, phase: "Construction", status: "In Progress", flagged: true, statusNote: "Started April 2026. Per the County's FY2026 Capital Project Fund List general ledger (Org 30047030, Object 563000, Project 10722): $107,069.80 FY2026 revised budget. Not previously listed on this ledger — flagged for review." },
    { name: "Old Town Santa Rosa SW Facility & Event Venue", projectNumber: "10313", orgCode: "30047000", startDate: "05/2022", category: "Transportation & Public Works", fy2026: 293740.12, phase: "Design", status: "In Progress", flagged: true, statusNote: "Started May 2022. Per the County's FY2026 Capital Project Fund List general ledger (Org 30047000, Object 563000, Project 10313): $293,740.12 FY2026 revised budget. Not previously listed on this ledger — flagged for review. This design contract also covers the related Nellie Drive Connector Road project's Phase 1 construction (tracked separately above), funded in part by an FDOT grant (FPN 450928-1-54-01).", contracts: [
      { phase: "Design", contractor: "Halff Associates, Inc. (sub: DAG Architects)", contractNumber: "RFQ 22-020, Task Order Bch Ops 24-004A", amount: "$330,500.00", date: "9/24/2024", note: "negotiation authorized 5/10/2022" }
    ] },
    { name: "Building Construction & Maintenance Facility", projectNumber: "10672", estimatedStartDate: "TBD", orgCode: "30047000", category: "Transportation & Public Works", fy2026: 2395000, phase: "Construction", status: "Programmed", flagged: true, statusNote: "Per the County's FY2026 Capital Project Fund List general ledger (Org 30047000, Object 562000, Project 10672): $2,395,000 FY2026 revised budget. Not previously listed on this ledger — flagged for review." },
    { name: "Sheriff Glendale Fire Station", projectNumber: "10074", estimatedStartDate: "TBD", orgCode: "30047000", category: "Sheriff’s Office", fy2026: 934625.30, phase: "Construction", status: "In Progress", flagged: true, statusNote: "Per the County's FY2026 Capital Project Fund List general ledger (Org 30047000, Object 562000, Project 10074): $934,625.30 FY2026 revised budget. Not previously listed on this ledger — flagged for review." },
    { name: "Sheriff Bruce Fire Station", projectNumber: "10651", estimatedStartDate: "TBD", orgCode: "30047000", category: "Sheriff’s Office", fy2026: 2000000, phase: "Construction", status: "Programmed", flagged: true, statusNote: "Per the County's FY2026 Capital Project Fund List general ledger (Org 30047000, Object 562000, Project 10651): $2,000,000 FY2026 revised budget. Not previously listed on this ledger — flagged for review." },

    { name: "Freeport 3280 Fire Station", category: "Sheriff’s Office", fy2025: 0, fy2026: 4200000 },
    { name: "Mossy Head Fire Station", category: "Sheriff’s Office", fy2025: 6000000, fy2026: 0 },
    { name: "Windswept Fire Station", category: "Sheriff’s Office", fy2025: 2000000, fy2026: 2000000 },
    { name: "Pleasant Ridge Fire Station", category: "Sheriff’s Office", fy2025: 0, fy2026: 4200000 },
    { name: "Paxtion Fire Building Transfer/Upgrades", category: "Sheriff’s Office", fy2025: 750000, fy2026: 0 },
    { name: "Radio Project", category: "Sheriff’s Office", fy2025: 8434000, fy2026: 8434000 },
    { name: "Fleet Shop - including EV", category: "Sheriff’s Office", fy2025: 0, fy2026: 1250000 }
];

/**
 * Run this ONCE manually from the Apps Script editor (select
 * "importHistoricalCipProjects" in the function dropdown next to Run,
 * then click Run) to bulk-append the county's FY2022-FY2026 historical
 * capital project record (HISTORICAL_CIP_PROJECTS above) into the
 * "Capital Improvement Plan" sheet, alongside the live FY2027-2031
 * projects — same sheet, same tab, not a separate one.
 *
 * Deliberately NOT reachable through doGet or doPost: this deployment is
 * public ("Anyone" access) so the website can read/update it without
 * login, and a bulk-row-append action reachable over the network would
 * let anyone inject arbitrary rows into this workbook. Running it
 * requires being signed into the Apps Script editor with edit access to
 * this script, the same trust boundary as authorizeAdditionalScopes() in
 * Code.gs.
 *
 * Safe to re-run: it skips any project name already present in the
 * sheet (checked against the sheet's current contents each run), so
 * re-running after a partial import, or by mistake, won't create
 * duplicate rows.
 *
 * Requires the "Capital Improvement Plan" sheet to already have the
 * FY2022-FY2026 Proposed and Status columns described in
 * docs/google-sheets-integration.md §10 — run this AFTER adding those
 * columns, not before.
 */
function importHistoricalCipProjects() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Capital Improvement Plan');
  if (!sheet) {
    throw new Error('Sheet not found: "Capital Improvement Plan".');
  }

  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function (header) { return String(header).trim(); });
  var colIndex = {};
  headers.forEach(function (header, i) { colIndex[header] = i; });

  if (colIndex[CAPITAL_PROJECTS_KEY_COLUMN] === undefined) {
    throw new Error('Sheet is missing its "' + CAPITAL_PROJECTS_KEY_COLUMN + '" column.');
  }

  var existingNames = {};
  for (var i = 1; i < values.length; i++) {
    var name = String(values[i][colIndex[CAPITAL_PROJECTS_KEY_COLUMN]] || '').trim();
    if (name) existingNames[name] = true;
  }

  // Historical entries only carry a broad grouping (category), not a real
  // department — approximated here the same way budgetv2 itself groups
  // these projects: Sheriff's Office rows go to "Sheriff", everything
  // else (Transportation & Public Works, Grant Funded) goes to
  // "Public Works" (the department that owns nearly all of them). The
  // broad category is used only to choose the closest owning department.
  function mapHistoricalDept(category) {
    return /sheriff/i.test(category || '') ? 'Sheriff' : 'Public Works';
  }

  var rows = [];
  var skipped = 0;
  HISTORICAL_CIP_PROJECTS.forEach(function (entry) {
    var name = entry.name || '';
    if (!name || existingNames[name]) {
      skipped++;
      return;
    }
    existingNames[name] = true; // guards duplicate names within the source array itself

    var row = headers.map(function (header) {
      switch (header) {
        case 'Budget Project Name(s)': return name;
        case 'Dept': return mapHistoricalDept(entry.category);
        case 'Budget Project Code(s)': return entry.projectNumber || '';
        case 'Budget Fund(s)': return entry.category === 'Grant Funded' ? 'Grant Funded' : '';
        case 'Project Phase': return entry.phase || 'None';
        case 'Project Priority': return 'None';
        case 'Status': return entry.status || 'Complete';
        case 'Start Date': return entry.startDate || entry.estimatedStartDate || '';
        case 'Estimated Completion Date': return entry.completedDate || entry.estimatedCompletionDate || '';
        case 'Budget Org Code(s)': return entry.orgCode || '';
        case 'Pertinent Information': return entry.statusNote || '';
        case 'FY2022 Proposed': return entry.fy2022 || 0;
        case 'FY2023 Proposed': return entry.fy2023 || 0;
        case 'FY2024 Proposed': return entry.fy2024 || 0;
        case 'FY2025 Proposed': return entry.fy2025 || 0;
        case 'FY2026 Proposed': return entry.fy2026 || 0;
        case 'FY2027 Proposed':
        case 'FY2028 Proposed':
        case 'FY2029 Proposed':
        case 'FY2030 Proposed':
        case 'FY2031 Proposed':
          return 0; // historical projects have no live proposed-year funding
        default:
          // Commissioner District, Location Name, Operational Impact,
          // Project Manager, Project Narrative, Strategic Goals, Budget
          // Account Code(s)/Name(s), In-House Engineering, Total
          // FY2027-FY2031, Status Notes, Last Updated, Last Updated By —
          // none of these exist in the historical source; left blank for
          // staff to fill in later if useful.
          return '';
      }
    });
    rows.push(row);
  });

  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  }

  Logger.log('Imported ' + rows.length + ' historical projects, skipped ' + skipped + ' (already present or blank name).');
}

/**
 * Recovery helper — run this ONCE manually (same way as
 * importHistoricalCipProjects: pick it from the function dropdown next
 * to Run, click Run) if historical projects were imported BEFORE the
 * "Status" column existed on the sheet, or before its header text
 * exactly matched "Status". In that situation importHistoricalCipProjects()
 * already skips those rows on any later re-run (it matches by project
 * name, which is already present), so their Status cell would otherwise
 * stay permanently blank even after the column is added correctly. This
 * patches ONLY the Status cell, and ONLY for rows that are (a) already in
 * HISTORICAL_CIP_PROJECTS and (b) currently have a blank Status cell —
 * it never touches a Status a human has since set by hand.
 *
 * Same trust boundary as importHistoricalCipProjects(): not reachable
 * through doGet/doPost, must be run from the Apps Script editor.
 */
function backfillHistoricalStatus() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Capital Improvement Plan');
  if (!sheet) {
    throw new Error('Sheet not found: "Capital Improvement Plan".');
  }

  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function (header) { return String(header).trim(); });
  var colIndex = {};
  headers.forEach(function (header, i) { colIndex[header] = i; });

  if (colIndex[CAPITAL_PROJECTS_KEY_COLUMN] === undefined) {
    throw new Error('Sheet is missing its "' + CAPITAL_PROJECTS_KEY_COLUMN + '" column.');
  }
  if (colIndex['Status'] === undefined) {
    throw new Error('Sheet is missing its "Status" column — add it (see docs/google-sheets-integration.md §10) before running this.');
  }

  var nameToRow = {};
  for (var i = 1; i < values.length; i++) {
    var name = String(values[i][colIndex[CAPITAL_PROJECTS_KEY_COLUMN]] || '').trim();
    if (name) nameToRow[name] = i + 1; // 1-indexed sheet row
  }

  var patched = 0;
  HISTORICAL_CIP_PROJECTS.forEach(function (entry) {
    var name = entry.name || '';
    var status = entry.status || '';
    if (!name || !status) return;
    var sheetRow = nameToRow[name];
    if (!sheetRow) return; // not on the sheet at all — importHistoricalCipProjects() handles that case

    var currentStatus = String(values[sheetRow - 1][colIndex['Status']] || '').trim();
    if (currentStatus) return; // already set (by a human, or a working prior import) — never overwrite

    sheet.getRange(sheetRow, colIndex['Status'] + 1).setValue(status);
    patched++;
  });

  Logger.log('Backfilled Status on ' + patched + ' historical project row(s).');
}
