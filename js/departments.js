/* =============================================================
   departments.js
   Department repository. The UI only ever talks to this module
   (never to GoogleSheets directly) — swapping the data source
   for a database later only requires changing googleSheets.js.

   Exposes: window.BudgetApp.Departments
   Depends on: window.BudgetApp.GoogleSheets
   ============================================================= */

window.BudgetApp = window.BudgetApp || {};

window.BudgetApp.Departments = (function (GoogleSheets) {
  'use strict';

  var records = [];

  function normalize(text) {
    return String(text || '').toLowerCase();
  }

  // Populates the in-memory list from the (possibly cached) Chart of
  // Accounts payload. Safe to call more than once (e.g. on refresh).
  function load() {
    return GoogleSheets.getData().then(function (data) {
      records = data.departments.slice();
      return records;
    });
  }

  function getAll() {
    return records.slice();
  }

  function findByCode(code) {
    var match = records.filter(function (d) { return d.code === code; });
    return match[0] || null;
  }

  // Matches on department code OR name, case-insensitive substring match.
  function search(query) {
    var q = normalize(query);
    if (!q) return records.slice();
    return records.filter(function (d) {
      return normalize(d.code).indexOf(q) !== -1 || normalize(d.name).indexOf(q) !== -1;
    });
  }

  return {
    load: load,
    getAll: getAll,
    findByCode: findByCode,
    search: search,
  };
})(window.BudgetApp.GoogleSheets);
