/* =============================================================
   workOrderApi.js
   The ONLY module that knows the Work Orders module talks to its
   own small Express/SQLite backend (see server/), unlike the rest
   of the portal which submits one-way to Google Apps Script. Work
   orders need to be read back and updated over time (status,
   assignment), which that one-way pattern can't do well.

   Swapping the API's location, or its backend entirely, later means
   changing only this file.

   Exposes: window.BudgetApp.WorkOrderApi
   ============================================================= */

window.BudgetApp = window.BudgetApp || {};

window.BudgetApp.WorkOrderApi = (function () {
  'use strict';

  // Points at the local dev server started with `npm start` inside
  // server/ (see server/README or the root README's Work Orders
  // section). Update this if the API is deployed somewhere else.
  var API_BASE_URL = 'http://localhost:4000/api';

  var REQUEST_TIMEOUT_MS = 15000;

  function request(path, options) {
    var controller = new AbortController();
    var timedOut = false;
    var timeoutId = setTimeout(function () {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    return fetch(API_BASE_URL + path, Object.assign({ signal: controller.signal }, options))
      .then(function (response) {
        clearTimeout(timeoutId);
        // DELETE responds 204 No Content — nothing to parse.
        if (response.status === 204) {
          return {};
        }
        return response.json().then(function (body) {
          if (!response.ok) {
            throw new Error((body && body.error) || 'Request failed (HTTP ' + response.status + ').');
          }
          return body;
        });
      })
      .catch(function (err) {
        clearTimeout(timeoutId);
        if (timedOut || (err && err.name === 'AbortError')) {
          throw new Error('The Work Orders service is taking longer than expected to respond.');
        }
        if (err instanceof TypeError) {
          throw new Error('Could not reach the Work Orders service. Is the server running (server/, npm start)?');
        }
        throw err;
      });
  }

  function getMeta() {
    return request('/work-orders-meta', { method: 'GET' });
  }

  // filters is an object like { status: 'New', location: 'Courthouse' } —
  // any key omitted, empty, or set to "All" is left unfiltered.
  function list(filters) {
    var params = [];
    Object.keys(filters || {}).forEach(function (field) {
      var value = filters[field];
      if (value && value !== 'All') {
        params.push(field + '=' + encodeURIComponent(value));
      }
    });
    var query = params.length > 0 ? '?' + params.join('&') : '';
    return request('/work-orders' + query, { method: 'GET' });
  }

  function create(workOrder) {
    return request('/work-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workOrder),
    });
  }

  function update(id, patch) {
    return request('/work-orders/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  }

  // ---------------------------------------------------------------
  // Admin-managed lists (locations, categories, assignees) — all
  // three share the same shape server-side (server/listResources.js),
  // so one set of calls covers all of them; resource is the plural
  // path segment, e.g. "locations".
  // ---------------------------------------------------------------
  function listResource(resource) {
    return request('/' + resource, { method: 'GET' });
  }

  function createResourceItem(resource, name) {
    return request('/' + resource, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name }),
    });
  }

  function deleteResourceItem(resource, id) {
    return request('/' + resource + '/' + encodeURIComponent(id), { method: 'DELETE' });
  }

  return {
    getMeta: getMeta,
    list: list,
    create: create,
    update: update,
    listResource: listResource,
    createResourceItem: createResourceItem,
    deleteResourceItem: deleteResourceItem,
  };
})();
