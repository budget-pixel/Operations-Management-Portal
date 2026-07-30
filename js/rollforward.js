/* =============================================================
   rollforward.js
   Page controller for rollforward.html — DOM wiring, the shared
   department combobox, a repeatable list of "account to roll
   forward" line items (each with its own Expense Account
   combobox, Amount, and Justification), validation, and
   submission. Mirrors app.js's role for transfer.html: the
   repeatable-row pattern (template clone / add / remove / at
   least one row) is the same idea as Transfer's Transfer From/To
   tables, just for a card-shaped line instead of a table row,
   since Justification needs a full-width textarea. Reuses the
   same underlying library modules (Calculations, GoogleSheets,
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
  var FISCAL_YEARS = ['2026-2027', '2027-2028'];

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

  var linesContainer = document.getElementById('rollforwardLines');
  var lineTemplate = document.getElementById('rollforwardLineTemplate');
  var addLineBtn = document.getElementById('addLineBtn');
  var linesTotalEl = document.getElementById('linesTotal');

  var fiscalYearSelect = document.getElementById('fiscalYearSelect');
  var fiscalYearErrorEl = document.getElementById('fiscalYear-error');

  var certificationInput = document.getElementById('certification');
  var certificationErrorEl = document.getElementById('certification-error');

  var requiredFields = [
    { input: document.getElementById('requesterName'), error: document.getElementById('requesterName-error'), message: 'Requester Name is required.' },
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
  // Department (shared by every line below)
  // -----------------------------------------------------------

  var selectedDepartment = null;
  var lines = []; // one entry per rendered "account to roll forward" block

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

  function refreshLineAccountLabel(line) {
    if (!line.selectedAccount) return;
    var projCode = line.projectInput.value.trim();
    line.accountController.setSelection({ label: buildAccountLabel(line.selectedAccount, projCode) });
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
      // Every line's account is scoped to the department — a department
      // change invalidates whatever was selected on each one, exactly
      // like changing department clears account selections on Transfer.
      lines.forEach(function (line) {
        line.selectedAccount = null;
        line.accountController.clearSelection(false);
        line.accountController.setDisabled(!dept);
        line.accountInput.placeholder = dept ? 'Search account by number or name...' : 'Select a department first...';
      });
      updateLinesTotal();
    },
  });

  // -----------------------------------------------------------
  // Repeatable "account to roll forward" line items
  // -----------------------------------------------------------

  function createLine() {
    var fragment = lineTemplate.content.cloneNode(true);
    var lineEl = fragment.querySelector('.rollforward-line');

    var accountInput = lineEl.querySelector('.account-input');
    var accountClearBtn = lineEl.querySelector('.combobox-clear');
    var accountListbox = lineEl.querySelector('.combobox-listbox');
    var accountErrorEl = lineEl.querySelector('.account-error');
    var projectInput = lineEl.querySelector('.project-input');
    var contractPoInput = lineEl.querySelector('.contract-po-input');
    var amountInput = lineEl.querySelector('.amount-input');
    var amountErrorEl = lineEl.querySelector('.amount-error');
    var justificationInput = lineEl.querySelector('.justification-input');
    var justificationErrorEl = lineEl.querySelector('.justification-error');
    var removeBtn = lineEl.querySelector('.remove-row-btn');
    var titleEl = lineEl.querySelector('.rollforward-line-title');

    var uid = 'rfline-' + Math.random().toString(36).slice(2);
    accountInput.id = uid + '-account';
    accountListbox.id = uid + '-account-listbox';
    lineEl.querySelector('.line-account-label').setAttribute('for', accountInput.id);
    projectInput.id = uid + '-project';
    lineEl.querySelector('.line-project-label').setAttribute('for', projectInput.id);
    contractPoInput.id = uid + '-contract-po';
    lineEl.querySelector('.line-contract-po-label').setAttribute('for', contractPoInput.id);
    amountInput.id = uid + '-amount';
    lineEl.querySelector('.line-amount-label').setAttribute('for', amountInput.id);
    justificationInput.id = uid + '-justification';
    lineEl.querySelector('.line-justification-label').setAttribute('for', justificationInput.id);

    var line = {
      el: lineEl,
      accountInput: accountInput,
      accountErrorEl: accountErrorEl,
      projectInput: projectInput,
      contractPoInput: contractPoInput,
      amountInput: amountInput,
      amountErrorEl: amountErrorEl,
      justificationInput: justificationInput,
      justificationErrorEl: justificationErrorEl,
      removeBtn: removeBtn,
      titleEl: titleEl,
      selectedAccount: null,
    };

    line.accountController = AccountSearch.createCombobox({
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
        line.selectedAccount = account;
        accountErrorEl.textContent = '';
        accountInput.removeAttribute('aria-invalid');

        // If this account already has a project number in the sheet, fill
        // it in automatically — same behavior as the Budget Transfer page.
        if (account && account.projectCode) {
          projectInput.value = account.projectCode;
          projectInput.removeAttribute('aria-invalid');
          refreshLineAccountLabel(line);
        }
      },
    });
    line.accountController.setDisabled(!selectedDepartment);
    accountInput.placeholder = selectedDepartment ? 'Search account by number or name...' : 'Select a department first...';

    projectInput.addEventListener('input', function () {
      accountErrorEl.textContent = '';
      projectInput.removeAttribute('aria-invalid');
      refreshLineAccountLabel(line);
    });

    amountInput.addEventListener('input', function () {
      Validation.setFieldError(amountInput, amountErrorEl, '');
      updateLinesTotal();
    });

    amountInput.addEventListener('blur', function () {
      if (Calculations.isValidAmount(amountInput.value)) {
        amountInput.value = Calculations.parseAmount(amountInput.value).toFixed(2);
        updateLinesTotal();
      }
    });

    justificationInput.addEventListener('input', function () {
      Validation.setFieldError(justificationInput, justificationErrorEl, '');
    });

    removeBtn.addEventListener('click', function () {
      removeLine(line);
    });

    return line;
  }

  function addLine() {
    var line = createLine();
    linesContainer.appendChild(line.el);
    lines.push(line);
    renumberLines();
    updateRemoveButtonsState();
    updateLinesTotal();
  }

  // Keeps at least one line so the section never collapses to nothing.
  function removeLine(line) {
    if (lines.length <= 1) return;
    var index = lines.indexOf(line);
    if (index === -1) return;
    lines.splice(index, 1);
    line.el.remove();
    renumberLines();
    updateRemoveButtonsState();
    updateLinesTotal();
  }

  function renumberLines() {
    lines.forEach(function (line, index) {
      line.titleEl.textContent = 'Rollforward Request #' + (index + 1);
    });
  }

  function updateRemoveButtonsState() {
    var onlyOneLine = lines.length <= 1;
    lines.forEach(function (line) {
      line.removeBtn.disabled = onlyOneLine;
    });
  }

  function getLinesTotal() {
    return Calculations.sumAmounts(lines.map(function (line) { return line.amountInput.value; }));
  }

  function updateLinesTotal() {
    linesTotalEl.textContent = Calculations.formatCurrency(getLinesTotal());
  }

  // Wipes and rebuilds the list down to a single empty line — used by
  // Clear Form, mirroring Transfer's resetTable().
  function resetLines() {
    linesContainer.innerHTML = '';
    lines = [];
    addLine();
  }

  addLineBtn.addEventListener('click', addLine);

  // -----------------------------------------------------------
  // Live error clearing (fields outside the repeatable lines)
  // -----------------------------------------------------------

  requiredFields.forEach(function (field) {
    field.input.addEventListener('input', function () {
      Validation.setFieldError(field.input, field.error, '');
    });
  });

  requesterEmailInput.addEventListener('input', function () {
    Validation.setFieldError(requesterEmailInput, requesterEmailErrorEl, '');
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

    // Every rendered line must be complete — unlike Transfer's fixed rows,
    // there's no "extra unused row" concept here: each line only exists
    // because the requester explicitly added it.
    lines.forEach(function (line) {
      if (!line.selectedAccount) {
        line.accountErrorEl.textContent = 'Select an expense account.';
        isValid = false;
        firstInvalidEl = firstInvalidEl || line.accountInput;
      } else {
        line.accountErrorEl.textContent = '';
      }

      if (!Calculations.isValidAmount(line.amountInput.value)) {
        Validation.setFieldError(
          line.amountInput, line.amountErrorEl,
          'Enter a valid amount between 0.01 and ' + Calculations.formatCurrency(Calculations.MAX_AMOUNT) + '.'
        );
        isValid = false;
        firstInvalidEl = firstInvalidEl || line.amountInput;
      } else {
        Validation.setFieldError(line.amountInput, line.amountErrorEl, '');
      }

      var justificationOk = Validation.validateRequiredField(
        line.justificationInput, line.justificationErrorEl, 'Detailed Justification is required.'
      );
      if (!justificationOk) {
        isValid = false;
        firstInvalidEl = firstInvalidEl || line.justificationInput;
      }
    });

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
      fiscalYear: fiscalYearSelect.value,
      certified: certificationInput.checked,
      lines: lines.map(function (line) {
        return {
          account: line.selectedAccount,
          projectCode: line.projectInput.value.trim(),
          contractPoNumber: line.contractPoInput.value.trim(),
          amount: line.amountInput.value,
          justification: line.justificationInput.value.trim(),
        };
      }),
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

  // Called instead of setSubmitting(false) once a submission succeeds —
  // the button stays disabled (Clear Form starts a fresh request), but
  // its label needs to move on from "Submitting…", which would otherwise
  // sit there indefinitely since success never calls setSubmitting(false).
  function markSubmitted() {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitted';
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
        markSubmitted();
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
    fiscalYearErrorEl.textContent = '';
    fiscalYearSelect.removeAttribute('aria-invalid');
    certificationErrorEl.textContent = '';
    departmentController.clearSelection(false);
    selectedDepartment = null;
    departmentErrorEl.textContent = '';
    resetLines();
    setSubmitting(false);
    hideStatus();
  });

  // -----------------------------------------------------------
  // Init
  // -----------------------------------------------------------

  addLine();
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
