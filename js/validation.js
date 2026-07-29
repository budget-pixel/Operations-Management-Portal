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

  // A department combobox holds a { code, name } selection (set via
  // AccountSearch's setSelection/onSelect), not raw text.
  function validateDepartmentSelection(selection, errorEl, message) {
    if (!selection) {
      errorEl.textContent = message;
      return false;
    }
    errorEl.textContent = '';
    return true;
  }

  // Project code is optional, but when present must be a plain 5-digit
  // number in the 10000-99999 range (not just any 5-character string —
  // e.g. "01234" has 5 digits but is numerically 1234, out of range).
  function isValidProjectCode(value) {
    return /^[0-9]{5}$/.test(value) && Number(value) >= 10000 && Number(value) <= 99999;
  }

  // Validates one Transfer From/To table's rows in place (sets aria-invalid
  // on offending inputs) and returns a summary the caller can display.
  //
  // Each row's account combobox stashes its resolved selection as
  // row._selectedAccount ({ type, code, name, departmentCode, departmentName })
  // — see app.js. That, not the input's display text, is the source of
  // truth: typed text that never became a real selection is invalid.
  function validateTransferRows(rows, sectionLabel, departmentCode) {
    var hasCompleteRow = false;
    var message = '';

    rows.forEach(function (row) {
      var accountInput = row.querySelector('.account-input');
      var amountInput = row.querySelector('.amount-input');
      var projectInput = row.querySelector('.project-input');
      var selection = row._selectedAccount || null;
      var hasTypedText = accountInput.value.trim() !== '';
      var hasAmount = amountInput.value.trim() !== '';
      var projectValue = projectInput.value.trim();
      var rowIsComplete = false;

      accountInput.removeAttribute('aria-invalid');
      amountInput.removeAttribute('aria-invalid');
      projectInput.removeAttribute('aria-invalid');

      if (hasTypedText && !selection) {
        accountInput.setAttribute('aria-invalid', 'true');
        message = 'Select an account from the list for every row you fill in.';
      } else if (selection && departmentCode && selection.departmentCode !== departmentCode) {
        // Defense in depth — the combobox is already department-scoped,
        // but a department change after selection could leave this stale.
        accountInput.setAttribute('aria-invalid', 'true');
        message = 'This account does not belong to the selected department.';
      } else if (selection && !hasAmount) {
        amountInput.setAttribute('aria-invalid', 'true');
        message = 'Enter an amount for every selected account.';
      } else if (!selection && hasAmount) {
        accountInput.setAttribute('aria-invalid', 'true');
        message = 'Select an account for every amount entered.';
      } else if (selection && hasAmount) {
        if (Calculations.isValidAmount(amountInput.value)) {
          rowIsComplete = true;
        } else {
          amountInput.setAttribute('aria-invalid', 'true');
          message = 'Enter a valid amount greater than 0.';
        }
      }

      if (projectValue && !isValidProjectCode(projectValue)) {
        projectInput.setAttribute('aria-invalid', 'true');
        message = 'Project code must be a number between 10000 and 99999.';
        rowIsComplete = false;
      }

      if (rowIsComplete) hasCompleteRow = true;
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
    validateDepartmentSelection: validateDepartmentSelection,
    validateTransferRows: validateTransferRows,
  };
})(window.BudgetApp.Calculations);
