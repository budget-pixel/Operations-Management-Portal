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
  var wholeDollarCurrencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  // Upper bound for any dollar amount entered anywhere in the app (Transfer
  // rows, Rollforward lines) — shared here so both forms enforce the same
  // ceiling with one definition instead of a hardcoded number in each.
  var MAX_AMOUNT = 99999999.99;

  // Strips everything but digits/decimal/minus and returns a number (0 if unparsable).
  function parseAmount(value) {
    var numeric = Number(String(value).replace(/[^0-9.-]/g, ''));
    return isFinite(numeric) ? numeric : 0;
  }

  // A row "counts" only if it has a positive numeric amount no greater than
  // MAX_AMOUNT.
  function isValidAmount(value) {
    var trimmed = String(value).trim();
    if (trimmed === '') return false;
    var numeric = Number(trimmed.replace(/[^0-9.-]/g, ''));
    return isFinite(numeric) && numeric > 0 && numeric <= MAX_AMOUNT;
  }

  function formatCurrency(amount) {
    return currencyFormatter.format(amount);
  }

  function formatWholeDollarCurrency(amount) {
    return wholeDollarCurrencyFormatter.format(amount);
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
    formatWholeDollarCurrency: formatWholeDollarCurrency,
    sumAmounts: sumAmounts,
    MAX_AMOUNT: MAX_AMOUNT,
  };
})();
