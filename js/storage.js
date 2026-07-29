/* =============================================================
   storage.js
   Draft persistence via the browser's Local Storage.
   No DOM access — works with plain data objects only.

   Exposes: window.BudgetApp.Storage
   ============================================================= */

window.BudgetApp = window.BudgetApp || {};

window.BudgetApp.Storage = (function () {
  'use strict';

  // v2: department/account fields changed from free text to structured
  // { code, name } selections. Bumping the key means any draft saved by
  // the old free-text version is simply never read back — there's no
  // sane way to migrate a typed account number into a real selection.
  var STORAGE_KEY = 'budgetTransferDraft_v2';

  function saveDraft(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function loadDraft() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  function clearDraft() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function hasDraft() {
    return localStorage.getItem(STORAGE_KEY) !== null;
  }

  return {
    saveDraft: saveDraft,
    loadDraft: loadDraft,
    clearDraft: clearDraft,
    hasDraft: hasDraft,
  };
})();
