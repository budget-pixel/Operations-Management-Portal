/* =============================================================
   googleSheets.js
   The ONLY module that knows the Chart of Accounts lives in a
   Google Sheet. Fetches from a Google Apps Script Web App proxy
   (see docs/google-sheets-integration.md) and caches the result
   in sessionStorage for the current tab.

   Swapping the data source for a real database later means
   changing only this file — departments.js/expenses.js/revenue.js
   and everything above them are unaffected.

   Exposes: window.BudgetApp.GoogleSheets
   ============================================================= */

window.BudgetApp = window.BudgetApp || {};

window.BudgetApp.GoogleSheets = (function () {
  'use strict';

  // Paste your deployed Apps Script Web App URL here.
  // See docs/google-sheets-integration.md for how to get one.
  var SHEETS_API_URL = 'https://script.google.com/macros/s/AKfycbxYjN-vJIZfjoY0gfpxw65F1ePhrfvdH_8ynqPCAD-S6PRnFpsYhFNZeHWm1Y1qsvF5Ag/exec';

  var CACHE_KEY = 'budgetAppCoaCache_v1';

  // Coalesces simultaneous callers (departments/expenses/revenue all load
  // at once on init) into a single in-flight network request.
  var pendingFetch = null;

  function isConfigured() {
    return /^https:\/\/script\.google\.com\//.test(SHEETS_API_URL);
  }

  function readCache() {
    var raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  function writeCache(data) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch (err) {
      // Storage full or unavailable — the cache is just an optimization,
      // so it's safe to skip persisting it.
    }
  }

  function fetchFromSheets() {
    if (!isConfigured()) {
      return Promise.reject(new Error(
        'The Chart of Accounts is not connected yet. See docs/google-sheets-integration.md to finish setup.'
      ));
    }

    return fetch(SHEETS_API_URL)
      .then(function (response) {
        if (!response.ok) {
          throw new Error('Chart of Accounts request failed (HTTP ' + response.status + ').');
        }
        return response.json();
      })
      .then(function (data) {
        if (data && data.error) {
          throw new Error(data.error);
        }
        var looksValid = data
          && Array.isArray(data.departments)
          && Array.isArray(data.expenses)
          && Array.isArray(data.revenue);
        if (!looksValid) {
          throw new Error('Chart of Accounts response was missing expected data.');
        }
        writeCache(data);
        return data;
      });
  }

  // Returns a Promise of { departments, expenses, revenue, fetchedAt }.
  function getData() {
    var cached = readCache();
    if (cached) return Promise.resolve(cached);

    if (!pendingFetch) {
      pendingFetch = fetchFromSheets().then(
        function (data) { pendingFetch = null; return data; },
        function (err) { pendingFetch = null; throw err; }
      );
    }
    return pendingFetch;
  }

  // Bypasses and replaces the cache with a fresh fetch.
  function refresh() {
    sessionStorage.removeItem(CACHE_KEY);
    pendingFetch = null;
    return getData();
  }

  return {
    getData: getData,
    refresh: refresh,
    isConfigured: isConfigured,
  };
})();
