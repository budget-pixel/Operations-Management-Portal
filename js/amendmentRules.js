/* =============================================================
   amendmentRules.js
   Central lookup for how each amendment type governs department
   selection. Intradepartmental uses a single department for both
   Transfer From and Transfer To; every other type uses two
   independent department selectors.

   Exposes: window.BudgetApp.AmendmentRules
   ============================================================= */

window.BudgetApp = window.BudgetApp || {};

window.BudgetApp.AmendmentRules = (function () {
  'use strict';

  var SINGLE = 'single';
  var DUAL = 'dual';

  var DEPARTMENT_MODE_BY_TYPE = {
    intradepartmental: SINGLE,
    interdepartmental: DUAL,
    reserve: DUAL,
    unanticipatedRevenue: DUAL,
    increasedReceipts: DUAL,
    publicHearing: DUAL,
  };

  // Returns 'single', 'dual', or null if no (or an unrecognized) amendment
  // type has been chosen yet.
  function getDepartmentMode(amendmentType) {
    return DEPARTMENT_MODE_BY_TYPE[amendmentType] || null;
  }

  return {
    SINGLE: SINGLE,
    DUAL: DUAL,
    getDepartmentMode: getDepartmentMode,
  };
})();
