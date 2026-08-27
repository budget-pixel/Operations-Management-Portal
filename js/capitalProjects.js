/* =============================================================
   capitalProjects.js
   Drives capital-projects.html: loads the Capital Improvement Plan
   ledger and posts in-place Project Phase/Status Notes updates.
   This talks to its OWN Apps Script Web App deployment — a
   separate spreadsheet (the Capital Improvement Plan workbook)
   from the Chart of Accounts one js/googleSheets.js uses, so it
   needs its own URL, its own cache, and its own fetch/submit code
   rather than reusing GoogleSheets (see
   docs/apps-script/CapitalProjectsCode.gs).

   Exposes: window.BudgetApp.CapitalProjects
   ============================================================= */

window.BudgetApp = window.BudgetApp || {};

window.BudgetApp.CapitalProjects = (function () {
  'use strict';

  // Paste your deployed Capital Improvement Plan Apps Script Web App URL
  // here. See docs/google-sheets-integration.md §10 for how to get one —
  // it is NOT the same URL as js/googleSheets.js's SHEETS_API_URL.
  var CIP_API_URL = 'https://script.google.com/macros/s/AKfycbyvOzSp25CNZlW1PUmVhvLkmOV8U1G4NtS15ThijH6b7zCnEr7Xyfx2DTktYDRdk4OP/exec';

  var CACHE_KEY = 'budgetAppCipCache_v1';
  var REQUEST_TIMEOUT_MS = 45000;

  var pendingFetch = null;

  function isConfigured() {
    return /^https:\/\/script\.google\.com\//.test(CIP_API_URL);
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
      // Storage full or unavailable — the cache is just an optimization.
    }
  }

  function fetchFromSheets() {
    if (!isConfigured()) {
      return Promise.reject(new Error(
        'The Capital Improvement Plan endpoint is not configured yet. See docs/google-sheets-integration.md §10.'
      ));
    }

    return fetch(CIP_API_URL)
      .then(function (response) {
        if (!response.ok) {
          throw new Error('Capital Improvement Plan request failed (HTTP ' + response.status + ').');
        }
        return response.json();
      })
      .then(function (data) {
        if (data && data.error) {
          throw new Error(data.error);
        }
        if (!data || !Array.isArray(data.capitalProjects)) {
          throw new Error('Capital Improvement Plan response was missing expected data.');
        }
        writeCache(data);
        return data;
      });
  }

  // Returns a Promise of the capitalProjects array.
  function getProjects() {
    var cached = readCache();
    if (cached) {
      return Promise.resolve(cached.capitalProjects || []);
    }

    if (!pendingFetch) {
      pendingFetch = fetchFromSheets().then(
        function (data) { pendingFetch = null; return data; },
        function (err) { pendingFetch = null; throw err; }
      );
    }
    return pendingFetch.then(function (data) { return data.capitalProjects || []; });
  }

  // Bypasses and replaces the cache with a fresh fetch.
  function refresh() {
    sessionStorage.removeItem(CACHE_KEY);
    pendingFetch = null;
    return getProjects();
  }

  // Shared by submitUpdate/createProject/deleteProject — posts `payload`
  // (which must include requestType) to the Apps Script deployment and
  // normalizes network/timeout/server-error failures into a message
  // that's safe to show the user directly.
  function postRequest(payload, timeoutMessage) {
    if (!isConfigured()) {
      return Promise.reject(new Error(
        'The Capital Improvement Plan endpoint is not configured yet. See docs/google-sheets-integration.md §10.'
      ));
    }

    var controller = new AbortController();
    var timedOut = false;
    var timeoutId = setTimeout(function () {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    return fetch(CIP_API_URL, {
      method: 'POST',
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
      .then(function (response) {
        clearTimeout(timeoutId);
        if (!response.ok) {
          throw new Error('Request failed (HTTP ' + response.status + ').');
        }
        return response.json();
      })
      .then(function (result) {
        if (!result || !result.success) {
          throw new Error((result && result.error) || 'Request failed. Please try again.');
        }
        return result;
      })
      .catch(function (err) {
        clearTimeout(timeoutId);
        if (timedOut || (err && err.name === 'AbortError')) {
          throw new Error(timeoutMessage);
        }
        if (err instanceof TypeError) {
          throw new Error('Could not reach the update service. Check your connection and try again.');
        }
        throw err;
      });
  }

  function submitUpdate(update) {
    // Forwards exactly the field(s) the caller passed — a deliberate
    // partial update (see saveProject() in js/capitalProjectDetail.js and
    // handleCapitalProjectUpdate in docs/apps-script/CapitalProjectsCode.gs
    // for why: sending unchanged fields back on every save previously
    // caused a race that could overwrite a just-saved value with a stale
    // one).
    return postRequest(
      Object.assign({}, update, { requestType: 'capitalProjectUpdate', updatedBy: update.updatedBy || '' }),
      'The update is taking longer than expected and may not have completed.'
    );
  }

  // Creates a brand-new project row. `fields` may include projectName
  // (required), dept, fund, phase, updatedBy — see
  // handleCapitalProjectCreate in CapitalProjectsCode.gs.
  function createProject(fields) {
    return postRequest(
      Object.assign({}, fields, { requestType: 'capitalProjectCreate', updatedBy: fields.updatedBy || '' }),
      'The request is taking longer than expected and the project may not have been created.'
    );
  }

  // Permanently deletes a project row by exact name.
  function deleteProject(projectName) {
    return postRequest(
      { requestType: 'capitalProjectDelete', projectName: projectName },
      'The request is taking longer than expected and the project may not have been deleted.'
    );
  }

  return {
    getProjects: getProjects,
    refresh: refresh,
    submitUpdate: submitUpdate,
    createProject: createProject,
    deleteProject: deleteProject,
    isConfigured: isConfigured,
  };
})();
