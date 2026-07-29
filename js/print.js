/* =============================================================
   print.js
   Print handling, isolated so print-specific behavior (page
   prep, print event hooks, etc.) has a single home as it grows.

   Exposes: window.BudgetApp.Print
   ============================================================= */

window.BudgetApp = window.BudgetApp || {};

window.BudgetApp.Print = (function () {
  'use strict';

  function printForm() {
    window.print();
  }

  // Register callbacks to run immediately before/after the print dialog —
  // useful later for things like expanding collapsed sections for print.
  function onBeforePrint(callback) {
    window.addEventListener('beforeprint', callback);
  }

  function onAfterPrint(callback) {
    window.addEventListener('afterprint', callback);
  }

  return {
    printForm: printForm,
    onBeforePrint: onBeforePrint,
    onAfterPrint: onAfterPrint,
  };
})();
