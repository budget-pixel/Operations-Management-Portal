/**
 * Budget Amendment Request — Chart of Accounts JSON proxy.
 *
 * Paste this entire file into the Apps Script editor of a script bound to
 * your Chart of Accounts spreadsheet (Extensions -> Apps Script). It reads
 * the three COA tabs and serves them as JSON so the static website can
 * fetch them with no API key and no server of its own — the spreadsheet
 * itself stays completely private.
 *
 * Expected tabs and exact header row text:
 *
 *   "COA Departments"  Department Code | Department Name
 *   "COA Expenses"     Department Code | Expense Object | Expense Object Name | Project
 *   "COA Revenue"      Org Code | Object Code | Name  (Project, if present, is ignored)
 *
 * COA Expenses and COA Revenue don't carry a department *name* column, only
 * a code (Department Code / Org Code) — departmentName comes back blank for
 * those two, which is fine since only departmentCode is used for filtering.
 *
 * Some COA Expenses rows are already tied to a specific project number in
 * their Project column — that comes back as projectCode so the client can
 * search by it and auto-fill it once that account is selected.
 *
 * See docs/google-sheets-integration.md for deployment steps.
 */

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
