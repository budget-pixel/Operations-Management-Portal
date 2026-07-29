/* =============================================================
   validation.js
   Field-level and form-level validation helpers.

   Exposes: window.BudgetApp.Validation
   Depends on: window.BudgetApp.Calculations (must load first)
   ============================================================= */

window.BudgetApp = window.BudgetApp || {};

window.BudgetApp.Validation = (function (Calculations) {
  'use strict';

  // Toggles aria-invalid + inline error text on a single field.
  function setFieldError(inputEl, errorEl, message) {
    if (message) {
      inputEl.setAttribute('aria-invalid', 'true');
      errorEl.textContent = message;
    } else {
      inputEl.removeAttribute('aria-invalid');
      errorEl.textContent = '';
    }
  }

  // Returns true/false and applies/clears the field's error as a side effect.
  function validateRequiredField(input, errorEl, message) {
    if (!input.value.trim()) {
      setFieldError(input, errorEl, message);
      return false;
    }
    setFieldError(input, errorEl, '');
    return true;
  }

  function validateAmendmentType(radios, errorEl) {
    var checked = radios.some(function (radio) { return radio.checked; });
    errorEl.textContent = checked ? '' : 'Select an amendment type.';
    return checked;
  }

  // Validates one Transfer From/To table's rows in place (sets aria-invalid
  // on offending inputs) and returns a summary the caller can display.
  function validateTransferRows(rows, sectionLabel) {
    var hasCompleteRow = false;
    var message = '';

    rows.forEach(function (row) {
      var accountInput = row.querySelector('.account-input');
      var amountInput = row.querySelector('.amount-input');
      var hasAccount = accountInput.value.trim() !== '';
      var hasAmount = amountInput.value.trim() !== '';

      accountInput.removeAttribute('aria-invalid');
      amountInput.removeAttribute('aria-invalid');

      if (hasAccount && !hasAmount) {
        amountInput.setAttribute('aria-invalid', 'true');
        message = 'Enter an amount for every account number.';
      } else if (hasAmount && !hasAccount) {
        accountInput.setAttribute('aria-invalid', 'true');
        message = 'Enter an account number for every amount.';
      } else if (hasAccount && hasAmount) {
        if (Calculations.isValidAmount(amountInput.value)) {
          hasCompleteRow = true;
        } else {
          amountInput.setAttribute('aria-invalid', 'true');
          message = 'Enter a valid amount greater than 0.';
        }
      }
    });

    if (!message && !hasCompleteRow) {
      message = 'Add at least one complete ' + sectionLabel + ' account and amount.';
    }

    return { isValid: !message, message: message };
  }

  return {
    setFieldError: setFieldError,
    validateRequiredField: validateRequiredField,
    validateAmendmentType: validateAmendmentType,
    validateTransferRows: validateTransferRows,
  };
})(window.BudgetApp.Calculations);
