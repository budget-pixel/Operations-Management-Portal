/* =============================================================
   rollforward.js
   Page controller for rollforward.html — DOM wiring, the single
   department/account combobox pair, validation, and submission.
   Mirrors app.js's role for transfer.html, but much simpler (one
   department, one expense account, one amount) so it isn't forced
   to share app.js's dual-department/multi-row machinery. Reuses
   the same underlying library modules (Calculations, GoogleSheets,
   Departments, Expenses, AccountSearch, Validation, Submission)
   completely unchanged — no department search or account filtering
   logic is duplicated here.

   Depends on (must load first): Calculations, GoogleSheets,
   Departments, Expenses, AccountSearch, Validation, Submission —
   see rollforward.html for load order.
   ============================================================= */

(function (Calculations, GoogleSheets, Departments, Expenses, AccountSearch, Validation, Submission) {
  'use strict';

  // Add future years here — everything else (the <select>'s options,
  // validation) picks this up automatically.
  var FISCAL_YEARS = ['2025-2026', '2026-2027', '2027-2028'];

  // -----------------------------------------------------------
  // Element references
  // -----------------------------------------------------------

  var form = document.getElementById('rollforwardForm');
  var coaStatusBanner = document.getElementById('coaStatusBanner');
  var statusBanner = document.getElementById('statusBanner');

  var submitBtn = document.getElementById('submitBtn');
  var clearBtn = document.getElementById('clearBtn');
  var submitBtnDefaultLabel = submitBtn.textContent;

  var departmentInput = document.getElementById('departmentInput');
  var departmentClearBtn = departmentInput.parentElement.querySelector('.combobox-clear');
  var departmentListbox = document.getElementById('departmentInput-listbox');
  var departmentErrorEl = document.getElementById('department-error');

  var accountInput = document.getElementById('accountInput');
  var accountClearBtn = accountInput.parentElement.querySelector('.combobox-clear');
  var accountListbox = document.getElementById('accountInput-listbox');
  var accountErrorEl = document.getElementById('account-error');
  var projectInput = document.getElementById('projectInput');

  var amountInput = document.getElementById('amountInput');
  var amountErrorEl = document.getElementById('amount-error');

  var fiscalYearSelect = document.getElementById('fiscalYearSelect');
  var fiscalYearErrorEl = document.getElementById('fiscalYear-error');

  var justificationInput = document.getElementById('justification');
  var justificationErrorEl = document.getElementById('justification-error');

  var certificationInput = document.getElementById('certification');
  var certificationErrorEl = document.getElementById('certification-error');

  var requiredFields = [
    { input: document.getElementById('requesterName'), error: document.getElementById('requesterName-error'), message: 'Requester Name is required.' },
    { input: justificationInput, error: justificationErrorEl, message: 'Detailed Justification is required.' },
  ];
  var requesterEmailInput = document.getElementById('requesterEmail');
  var requesterEmailErrorEl = document.getElementById('requesterEmail-error');

  var submissionModal = document.getElementById('submissionModal');
  var submissionModalBody = document.getElementById('submissionModalBody');
  var submissionModalCloseBtn = document.getElementById('submissionModalCloseBtn');

  // -----------------------------------------------------------
  // Fiscal Year dropdown
  // -----------------------------------------------------------

  FISCAL_YEARS.forEach(function (year) {
    var option = document.createElement('option');
    option.value = year;
    option.textContent = year;
    fiscalYearSelect.appendChild(option);
  });

  // -----------------------------------------------------------
  // Department + Expense Account comboboxes
  // -----------------------------------------------------------

  var selectedDepartment = null;
  var selectedAccount = null;

  // Prefers the normalized matchCode (see Code.gs's normalizeDeptCode) for
  // account filtering, matching how transfer.html's app.js does it.
  function getDeptMatchCode(dept) {
    if (!dept) return null;
    return dept.matchCode || dept.code || null;
  }

  // "DeptCode-ObjectCode[-ProjectCode]" — matches the composite number
  // shown on the Budget Transfer page (js/app.js's buildAccountNumber).
  function buildAccountNumber(account, projCode) {
    var parts = [selectedDepartment ? selectedDepartment.code : '', account.code];
    if (projCode) parts.push(projCode);
    return parts.filter(Boolean).join('-');
  }

  function buildAccountLabel(account, projCode) {
    return buildAccountNumber(account, projCode) + ' - ' + account.name;
  }

  function refreshAccountLabel() {
    if (!selectedAccount) return;
    var projCode = projectInput.value.trim();
    accountController.setSelection({ label: buildAccountLabel(selectedAccount, projCode) });
  }

  var departmentController = AccountSearch.createCombobox({
    inputEl: departmentInput,
    clearBtnEl: departmentClearBtn,
    listboxEl: departmentListbox,
    wrapperEl: departmentInput.closest('.combobox'),
    emptyMessage: 'No matching departments.',
    getResults: function (query) {
      return Departments.search(query).map(function (dept) {
        return { id: dept.code, label: dept.code + ' - ' + dept.name, data: dept };
      });
    },
    onSelect: function (dept) {
      departmentErrorEl.textContent = '';
      selectedDepartment = dept;
      selectedAccount = null;
      projectInput.value = '';
      accountController.setDisabled(!dept);
      accountInput.placeholder = dept ? 'Search account by number or name...' : 'Select a department first...';
    },
  });

  var accountController = AccountSearch.createCombobox({
    inputEl: accountInput,
    clearBtnEl: accountClearBtn,
    listboxEl: accountListbox,
    wrapperEl: accountInput.closest('.combobox'),
    emptyMessage: 'No matching accounts.',
    getResults: function (query) {
      var deptCode = getDeptMatchCode(selectedDepartment);
      if (!deptCode) return [];
      return Expenses.search(query, deptCode).map(function (acct) {
        var projCode = acct.projectCode || projectInput.value.trim();
        return {
          id: acct.code,
          label: buildAccountLabel(acct, projCode),
          data: acct,
        };
      });
    },
    onSelect: function (account) {
      selectedAccount = account;
      accountErrorEl.textContent = '';
      accountInput.removeAttribute('aria-invalid');

      // If this account already has a project number in the sheet, fill
      // it in automatically instead of making the requester retype a
      // number the chart of accounts already determines — same behavior
      // as the Budget Transfer page.
      if (account && account.projectCode) {
        projectInput.value = account.projectCode;
        projectInput.removeAttribute('aria-invalid');
        refreshAccountLabel();
      }
    },
  });
  accountController.setDisabled(true);

  projectInput.addEventListener('input', function () {
    accountErrorEl.textContent = '';
    projectInput.removeAttribute('aria-invalid');
    refreshAccountLabel();
  });

  // -----------------------------------------------------------
  // Live error clearing
  // -----------------------------------------------------------

  requiredFields.forEach(function (field) {
    field.input.addEventListener('input', function () {
      Validation.setFieldError(field.input, field.error, '');
    });
  });

  requesterEmailInput.addEventListener('input', function () {
    Validation.setFieldError(requesterEmailInput, requesterEmailErrorEl, '');
  });

  amountInput.addEventListener('input', function () {
    Validation.setFieldError(amountInput, amountErrorEl, '');
  });

  amountInput.addEventListener('blur', function () {
    if (Calculations.isValidAmount(amountInput.value)) {
      amountInput.value = Calculations.parseAmount(amountInput.value).toFixed(2);
    }
  });

  fiscalYearSelect.addEventListener('change', function () {
    fiscalYearErrorEl.textContent = '';
    fiscalYearSelect.removeAttribute('aria-invalid');
  });

  certificationInput.addEventListener('change', function () {
    if (certificationInput.checked) certificationErrorEl.textContent = '';
  });

  // -----------------------------------------------------------
  // Validation
  // -----------------------------------------------------------

  function validateForm() {
    var isValid = true;
    var firstInvalidEl = null;

    requiredFields.forEach(function (field) {
      var ok = Validation.validateRequiredField(field.input, field.error, field.message);
      if (!ok) {
        isValid = false;
        firstInvalidEl = firstInvalidEl || field.input;
      }
    });

    var emailOk = Validation.validateEmailField(
      requesterEmailInput, requesterEmailErrorEl,
      'Requester Email is required.', 'Enter a valid email address.'
    );
    if (!emailOk) {
      isValid = false;
      firstInvalidEl = firstInvalidEl || requesterEmailInput;
    }

    var deptOk = Validation.validateDepartmentSelection(selectedDepartment, departmentErrorEl, 'Select a department.');
    if (!deptOk) {
      isValid = false;
      firstInvalidEl = firstInvalidEl || departmentInput;
    }

    if (!selectedAccount) {
      accountErrorEl.textContent = 'Select an expense account.';
      isValid = false;
      firstInvalidEl = firstInvalidEl || accountInput;
    } else {
      accountErrorEl.textContent = '';
    }

    if (!Calculations.isValidAmount(amountInput.value)) {
      Validation.setFieldError(amountInput, amountErrorEl, 'Enter a valid amount greater than 0.');
      isValid = false;
      firstInvalidEl = firstInvalidEl || amountInput;
    } else {
      Validation.setFieldError(amountInput, amountErrorEl, '');
    }

    if (!fiscalYearSelect.value) {
      fiscalYearSelect.setAttribute('aria-invalid', 'true');
      fiscalYearErrorEl.textContent = 'Select a fiscal year.';
      isValid = false;
      firstInvalidEl = firstInvalidEl || fiscalYearSelect;
    } else {
      fiscalYearSelect.removeAttribute('aria-invalid');
      fiscalYearErrorEl.textContent = '';
    }

    var certOk = Validation.validateCheckbox(
      certificationInput, certificationErrorEl,
      'You must certify the request before submitting.'
    );
    if (!certOk) {
      isValid = false;
      firstInvalidEl = firstInvalidEl || certificationInput;
    }

    return { isValid: isValid, firstInvalidEl: firstInvalidEl };
  }

  // -----------------------------------------------------------
  // Collecting form data
  // -----------------------------------------------------------

  function collectFormData() {
    return {
      requestType: 'rollforward',
      requesterName: document.getElementById('requesterName').value.trim(),
      requesterEmail: requesterEmailInput.value.trim(),
      department: selectedDepartment,
      account: selectedAccount,
      projectCode: projectInput.value.trim(),
      amount: amountInput.value,
      fiscalYear: fiscalYearSelect.value,
      justification: justificationInput.value.trim(),
      certified: certificationInput.checked,
    };
  }

  // -----------------------------------------------------------
  // Status banner + submission modal
  // -----------------------------------------------------------

  function showStatus(variant, message) {
    statusBanner.className = 'banner no-print ' + variant;
    statusBanner.textContent = message;
    statusBanner.hidden = false;
  }

  function hideStatus() {
    statusBanner.hidden = true;
  }

  function setSubmitting(isSubmitting) {
    submitBtn.disabled = isSubmitting;
    submitBtn.textContent = isSubmitting ? 'Submitting…' : submitBtnDefaultLabel;
  }

  function showSubmissionModal(requestId) {
    submissionModalBody.textContent = 'Your Fiscal Year Rollforward Request has been submitted to the '
      + 'Office of Management and Budget. Request ID: ' + requestId;
    submissionModal.hidden = false;
    submissionModalCloseBtn.focus();
  }

  function hideSubmissionModal() {
    submissionModal.hidden = true;
  }

  submissionModalCloseBtn.addEventListener('click', hideSubmissionModal);

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !submissionModal.hidden) {
      hideSubmissionModal();
    }
  });

  // -----------------------------------------------------------
  // Chart of Accounts loading
  // -----------------------------------------------------------

  function showCoaBanner(variant, text) {
    coaStatusBanner.className = 'banner no-print ' + variant;
    coaStatusBanner.innerHTML = '';
    var span = document.createElement('span');
    span.textContent = text;
    coaStatusBanner.appendChild(span);
    coaStatusBanner.hidden = false;
    return span;
  }

  function showCoaLoading() {
    showCoaBanner('banner-info', 'Loading Chart of Accounts...');
  }

  function showCoaError(err) {
    showCoaBanner('banner-error', err && err.message ? err.message : 'Could not load the Chart of Accounts.');
    var retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'btn btn-secondary';
    retryBtn.textContent = 'Retry';
    retryBtn.addEventListener('click', loadChartOfAccounts);
    coaStatusBanner.appendChild(retryBtn);
  }

  function showCoaLoaded(departmentCount, expenseCount) {
    var message = 'Chart of Accounts loaded — '
      + departmentCount + ' department' + (departmentCount === 1 ? '' : 's') + ', '
      + expenseCount + ' expense account' + (expenseCount === 1 ? '' : 's') + '.';
    showCoaBanner('banner-info', message);
    var refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'btn btn-ghost';
    refreshBtn.textContent = 'Refresh Chart of Accounts';
    refreshBtn.addEventListener('click', handleRefreshCoa);
    coaStatusBanner.appendChild(refreshBtn);
  }

  function handleRefreshCoa() {
    showCoaLoading();
    GoogleSheets.refresh()
      .then(function () {
        return Promise.all([Departments.load(), Expenses.load()]);
      })
      .then(function (results) {
        showCoaLoaded(results[0].length, results[1].length);
      })
      .catch(function (err) {
        showCoaError(err);
      });
  }

  function loadChartOfAccounts() {
    showCoaLoading();
    return Promise.all([Departments.load(), Expenses.load()])
      .then(function (results) {
        showCoaLoaded(results[0].length, results[1].length);
      })
      .catch(function (err) {
        showCoaError(err);
      });
  }

  // -----------------------------------------------------------
  // Event wiring
  // -----------------------------------------------------------

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var result = validateForm();

    if (!result.isValid) {
      showStatus('banner-error', 'Please correct the highlighted fields before submitting.');
      if (result.firstInvalidEl) {
        result.firstInvalidEl.focus();
        result.firstInvalidEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    var requestData = collectFormData();

    setSubmitting(true);
    showStatus('banner-info', 'Submitting your request…');

    Submission.submit(requestData)
      .then(function (result) {
        hideStatus();
        showSubmissionModal(result.requestId);
      })
      .catch(function (err) {
        showStatus('banner-error', err && err.message ? err.message : 'Something went wrong submitting the request. Please try again.');
        setSubmitting(false);
      });
  });

  clearBtn.addEventListener('click', function () {
    var confirmed = window.confirm('Clear the form? Any unsaved changes will be lost.');
    if (!confirmed) return;

    form.reset();
    requiredFields.forEach(function (field) { Validation.setFieldError(field.input, field.error, ''); });
    Validation.setFieldError(requesterEmailInput, requesterEmailErrorEl, '');
    Validation.setFieldError(amountInput, amountErrorEl, '');
    fiscalYearErrorEl.textContent = '';
    fiscalYearSelect.removeAttribute('aria-invalid');
    certificationErrorEl.textContent = '';
    departmentController.clearSelection(false);
    accountController.clearSelection(false);
    accountController.setDisabled(true);
    accountInput.placeholder = 'Select a department first...';
    selectedDepartment = null;
    selectedAccount = null;
    departmentErrorEl.textContent = '';
    accountErrorEl.textContent = '';
    setSubmitting(false);
    hideStatus();
  });

  // -----------------------------------------------------------
  // Init
  // -----------------------------------------------------------

  loadChartOfAccounts();
})(
  window.BudgetApp.Calculations,
  window.BudgetApp.GoogleSheets,
  window.BudgetApp.Departments,
  window.BudgetApp.Expenses,
  window.BudgetApp.AccountSearch,
  window.BudgetApp.Validation,
  window.BudgetApp.Submission
);
