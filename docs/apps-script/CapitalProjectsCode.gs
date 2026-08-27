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
 * doPost handles exactly one request type, 'capitalProjectUpdate' — see
 * handleCapitalProjectUpdate() below. Unlike Code.gs's doPost handlers,
 * this doesn't append a new row; it finds an existing "Capital
 * Improvement Plan" row by project name and rewrites just its Project
 * Phase, Status Notes, Last Updated, and Last Updated By cells, leaving
 * every other budget-book column untouched.
 *
 * Expected tab and exact header row text — "Capital Improvement Plan":
 *
 *   Budget Project Name(s) | Dept | Budget Project Code(s) |
 *   Commissioner District | Estimated Completion Date | Budget Fund(s) |
 *   Funding Source | Location Name | Operational Impact |
 *   Pertinent Information | Project Manager | Project Narrative |
 *   Project Phase | Project Priority | Start Date | Strategic Goals |
 *   Budget Org Code(s) | Budget Account Code(s) | Budget Account Name(s) |
 *   In-House Engineering | FY2027 Proposed | FY2028 Proposed |
 *   FY2029 Proposed | FY2030 Proposed | FY2031 Proposed |
 *   Total FY2027-FY2031 | Status Notes | Last Updated | Last Updated By
 *
 * The first 26 columns are the county's existing budget-book data; the
 * last three ("Status Notes", "Last Updated", "Last Updated By") are the
 * only columns this module requires you to add. `Budget Project Name(s)`
 * is the row-matching key — the sheet has no separate ID column, and
 * names are unique in the live workbook.
 *
 * See docs/google-sheets-integration.md §10 for full setup steps.
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
    dept: cell(record, 'Dept'),
    projectCode: cell(record, 'Budget Project Code(s)'),
    commissionerDistrict: cell(record, 'Commissioner District'),
    estCompletionDate: cell(record, 'Estimated Completion Date'),
    fund: cell(record, 'Budget Fund(s)'),
    fundingSource: cell(record, 'Funding Source'),
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
  'Status Notes', 'Last Updated', 'Last Updated By',
];

/**
 * Handles a Capital Project phase/notes update from
 * capital-projects.html — finds an existing "Capital Improvement Plan"
 * row by its project name (the sheet has no separate ID column, and
 * project names are unique in the live workbook) and rewrites just its
 * Project Phase, Status Notes, Last Updated, and Last Updated By cells in
 * place, leaving every other column (budget figures, fund, department,
 * narrative, etc.) untouched.
 *
 * Input: the spreadsheet, and { projectName, phase, statusNotes,
 * updatedBy }.
 * Output: { success: true, projectName } or { success: false, error }.
 */
function handleCapitalProjectUpdate(ss, requestData) {
  var projectName = String(requestData && requestData.projectName || '').trim();
  if (!projectName) {
    return { success: false, error: 'Project name is required.' };
  }
  var phase = String(requestData && requestData.phase || '').trim();
  if (!phase) {
    return { success: false, error: 'Project Phase is required.' };
  }
  if (!isValidLength(phase, 60) || !isValidLength(requestData.statusNotes, 2000)) {
    return { success: false, error: 'Project Phase or Status Notes is too long.' };
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
  if (colIndex[CAPITAL_PROJECTS_KEY_COLUMN] === -1 || colIndex[CAPITAL_PROJECTS_PHASE_COLUMN] === -1) {
    return { success: false, error: 'Capital Improvement Plan sheet is missing a required column (' + CAPITAL_PROJECTS_KEY_COLUMN + ' or ' + CAPITAL_PROJECTS_PHASE_COLUMN + ').' };
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

  var sheetRow = rowIndex + 1; // getRange is 1-indexed; values is 0-indexed.
  sheet.getRange(sheetRow, colIndex[CAPITAL_PROJECTS_PHASE_COLUMN] + 1).setValue(phase);
  if (colIndex['Status Notes'] !== -1) {
    sheet.getRange(sheetRow, colIndex['Status Notes'] + 1).setValue(String(requestData.statusNotes || ''));
  }
  if (colIndex['Last Updated'] !== -1) {
    sheet.getRange(sheetRow, colIndex['Last Updated'] + 1).setValue(new Date());
  }
  if (colIndex['Last Updated By'] !== -1) {
    sheet.getRange(sheetRow, colIndex['Last Updated By'] + 1).setValue(String(requestData.updatedBy || ''));
  }

  return { success: true, projectName: projectName };
}
