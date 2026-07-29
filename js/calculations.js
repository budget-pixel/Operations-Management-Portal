/* =============================================================
   calculations.js
   Pure currency/number helpers. No DOM access — safe to unit
   test or reuse elsewhere.

   Exposes: window.BudgetApp.Calculations
   ============================================================= */

window.BudgetApp = window.BudgetApp || {};

window.BudgetApp.Calculations = (function () {
  'use strict';

  var currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  });

  // Strips everything but digits/decimal/minus and returns a number (0 if unparsable).
  function parseAmount(value) {
    var numeric = Number(String(value).replace(/[^0-9.-]/g, ''));
    return isFinite(numeric) ? numeric : 0;
  }

  // A row "counts" only if it has a positive numeric amount.
  function isValidAmount(value) {
    var trimmed = String(value).trim();
    if (trimmed === '') return false;
    var numeric = Number(trimmed.replace(/[^0-9.-]/g, ''));
    return isFinite(numeric) && numeric > 0;
  }

  function formatCurrency(amount) {
    return currencyFormatter.format(amount);
  }

  function sumAmounts(values) {
    return values.reduce(function (sum, value) {
      return sum + parseAmount(value);
    }, 0);
  }

  return {
    parseAmount: parseAmount,
    isValidAmount: isValidAmount,
    formatCurrency: formatCurrency,
    sumAmounts: sumAmounts,
  };
})();
