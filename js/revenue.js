/* =============================================================
   revenue.js
   Revenue code repository, scoped by department. Mirrors
   expenses.js's shape so accountSearch.js can treat both
   uniformly. The UI only ever talks to this module (never to
   GoogleSheets directly).

   Exposes: window.BudgetApp.Revenue
   Depends on: window.BudgetApp.GoogleSheets
   ============================================================= */

window.BudgetApp = window.BudgetApp || {};

window.BudgetApp.Revenue = (function (GoogleSheets) {
  'use strict';

  var records = [];

  function normalize(text) {
    return String(text || '').toLowerCase();
  }

  function load() {
    return GoogleSheets.getData().then(function (data) {
      records = data.revenue.slice();
      return records;
    });
  }

  function getAll() {
    return records.slice();
  }

  function getByDepartment(departmentCode) {
    return records.filter(function (r) { return r.departmentCode === departmentCode; });
  }

  function findByCode(code, departmentCode) {
    var match = records.filter(function (r) {
      return r.code === code && (!departmentCode || r.departmentCode === departmentCode);
    });
    return match[0] || null;
  }

  // Matches on revenue code OR name, case-insensitive substring match,
  // optionally scoped to a single department.
  function search(query, departmentCode) {
    var q = normalize(query);
    var pool = departmentCode ? getByDepartment(departmentCode) : records;
    if (!q) return pool.slice();
    return pool.filter(function (r) {
      return normalize(r.code).indexOf(q) !== -1 || normalize(r.name).indexOf(q) !== -1;
    });
  }

  return {
    load: load,
    getAll: getAll,
    getByDepartment: getByDepartment,
    findByCode: findByCode,
    search: search,
  };
})(window.BudgetApp.GoogleSheets);
