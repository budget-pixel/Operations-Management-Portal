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
 *   "COA Expenses"     Department Code | Expense Object | Expense Object Name  (Project is ignored)
 *   "COA Revenue"      Org Code | Object Code | Name
 *
 * COA Expenses and COA Revenue don't carry a department *name* column, only
 * a code (Department Code / Org Code) — departmentName comes back blank for
 * those two, which is fine since only departmentCode is used for filtering.
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
// (e.g. "107000") — normalizing both sides the same way here means the
// client can match them with plain string equality without knowing about
// the inconsistency.
function normalizeDeptCode(value) {
  var stripped = String(value).trim().replace(/^0+/, '');
  return stripped === '' ? '0' : stripped;
}

function mapDepartmentRow(record) {
  return {
    code: normalizeDeptCode(cell(record, 'Department Code')),
    name: cell(record, 'Department Name'),
  };
}

function mapExpenseRow(record) {
  return {
    departmentCode: normalizeDeptCode(cell(record, 'Department Code')),
    departmentName: '',
    code: cell(record, 'Expense Object'),
    name: cell(record, 'Expense Object Name'),
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
