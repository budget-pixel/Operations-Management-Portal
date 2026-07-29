/* =============================================================
   storage.js
   Draft persistence via the browser's Local Storage.
   No DOM access — works with plain data objects only.

   Exposes: window.BudgetApp.Storage
   ============================================================= */

window.BudgetApp = window.BudgetApp || {};

window.BudgetApp.Storage = (function () {
  'use strict';

  var STORAGE_KEY = 'budgetTransferDraft';

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
