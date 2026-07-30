/* =============================================================
   submission.js
   Sends a completed Budget Transfer Request to the Apps Script
   backend (see docs/apps-script/Code.gs's doPost) — Sheets
   storage, PDF generation, Drive save, and email are all handled
   server-side; this module's only job is the network call.

   Exposes: window.BudgetApp.Submission
   Depends on: window.BudgetApp.GoogleSheets (reuses its API URL)
   ============================================================= */

window.BudgetApp = window.BudgetApp || {};

window.BudgetApp.Submission = (function (GoogleSheets) {
  'use strict';

  /**
   * Submits a completed request.
   *
   * @param {Object} requestData - the same shape app.js's
   *   collectFormData() produces, plus requestorEmail.
   * @returns {Promise<{success: true, requestId: string}>}
   *   Resolves on a successful submission. Rejects with an Error whose
   *   `message` is safe to show the user (network failure, HTTP error, or
   *   the server's own validation/processing error message).
   *
   * Sent with no explicit Content-Type header — Apps Script Web Apps can't
   * handle a CORS preflight (OPTIONS) request, and a plain-string fetch()
   * body defaults to "text/plain", which browsers exempt from preflight.
   * doPost parses the raw body as JSON regardless of the declared type.
   */
  function submit(requestData) {
    if (!GoogleSheets.isConfigured()) {
      return Promise.reject(new Error(
        'The Chart of Accounts / submission endpoint is not configured yet. See docs/google-sheets-integration.md.'
      ));
    }

    return fetch(GoogleSheets.getApiUrl(), {
      method: 'POST',
      body: JSON.stringify(requestData),
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('Submission request failed (HTTP ' + response.status + ').');
        }
        return response.json();
      })
      .then(function (result) {
        if (!result || !result.success) {
          throw new Error((result && result.error) || 'Submission failed. Please try again.');
        }
        return result;
      })
      .catch(function (err) {
        // Normalizes a raw network failure (fetch rejects with a generic
        // TypeError, no useful message) into something displayable.
        if (err instanceof TypeError) {
          throw new Error('Could not reach the submission service. Check your connection and try again.');
        }
        throw err;
      });
  }

  return {
    submit: submit,
  };
})(window.BudgetApp.GoogleSheets);
