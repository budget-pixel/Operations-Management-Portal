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
 *   "COA Expenses"     Department Code | Department Name | Expense Object Code | Expense Object Name
 *   "COA Revenue"       Department Code | Department Name | Revenue Code | Revenue Name
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

function mapDepartmentRow(record) {
  return {
    code: cell(record, 'Department Code'),
    name: cell(record, 'Department Name'),
  };
}

function mapExpenseRow(record) {
  return {
    departmentCode: cell(record, 'Department Code'),
    departmentName: cell(record, 'Department Name'),
    code: cell(record, 'Expense Object Code'),
    name: cell(record, 'Expense Object Name'),
  };
}

function mapRevenueRow(record) {
  return {
    departmentCode: cell(record, 'Department Code'),
    departmentName: cell(record, 'Department Name'),
    code: cell(record, 'Revenue Code'),
    name: cell(record, 'Revenue Name'),
  };
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
