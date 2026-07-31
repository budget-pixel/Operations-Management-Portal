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
   Departments, Expenses, AccountSearch, Validation, Print, Submission)
   completely unchanged — no department search or account filtering
   logic is duplicated here.

   Depends on (must load first): Calculations, GoogleSheets,
   Departments, Expenses, AccountSearch, Validation, Print, Submission —
   see rollforward.html for load order.
   ============================================================= */

(function (Calculations, GoogleSheets, Departments, Expenses, AccountSearch, Validation, Print, Submission) {
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
  var printBtn = document.getElementById('printBtn');
  var clearBtn = document.getElementById('clearBtn');
  var submitBtnDefaultLabel = submitBtn.textContent;

  var printEls = {
    date: document.getElementById('printDate'),
    requesterName: document.getElementById('printRequesterName'),
    title: document.getElementById('printTitle'),
    requesterEmail: document.getElementById('printRequesterEmail'),
    department: document.getElementById('printDepartment'),
    fiscalYear: document.getElementById('printFiscalYear'),
    lines: document.getElementById('printLines'),
    linesTotal: document.getElementById('printLinesTotal'),
  };

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
    { input: document.getElementById('date'), error: document.getElementById('date-error'), message: 'Date is required.' },
    { input: document.getElementById('requesterName'), error: document.getElementById('requesterName-error'), message: 'Requester Name is required.' },
    { input: document.getElementById('title'), error: document.getElementById('title-error'), message: 'Title is required.' },
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
      date: document.getElementById('date').value,
      requesterName: document.getElementById('requesterName').value.trim(),
      title: document.getElementById('title').value.trim(),
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
  // Print view — a separate, compact clerical view (see #printView in
  // rollforward.html), populated fresh from current form state right
  // before printing. Only lines with a selected account are included.
  // Mirrors app.js's populatePrintView()/populatePrintTable() for
  // transfer.html, but renders one bordered block per line instead of a
  // table, since Justification needs full-width room to read.
  // -----------------------------------------------------------

  function formatPrintDate(isoDate) {
    if (!isoDate) return '—';
    // Split/rearrange the "YYYY-MM-DD" string directly rather than going
    // through `new Date(...)`, which parses that format as UTC midnight
    // and can display a day off in negative-UTC-offset timezones.
    var parts = isoDate.split('-');
    return parts.length === 3 ? (parts[1] + '/' + parts[2] + '/' + parts[0]) : isoDate;
  }

  function populatePrintView() {
    printEls.date.textContent = formatPrintDate(document.getElementById('date').value);
    printEls.requesterName.textContent = document.getElementById('requesterName').value.trim() || '—';
    printEls.title.textContent = document.getElementById('title').value.trim() || '—';
    printEls.requesterEmail.textContent = requesterEmailInput.value.trim() || '—';
    printEls.department.textContent = selectedDepartment
      ? (selectedDepartment.code + ' - ' + selectedDepartment.name)
      : '—';
    printEls.fiscalYear.textContent = fiscalYearSelect.value || '—';

    printEls.lines.innerHTML = '';
    var filledLines = lines.filter(function (line) { return line.selectedAccount; });

    filledLines.forEach(function (line, index) {
      var account = line.selectedAccount;
      var projCode = line.projectInput.value.trim();
      var contractPo = line.contractPoInput.value.trim();
      var amount = Calculations.parseAmount(line.amountInput.value);
      var accountNumber = buildAccountNumber(account, projCode);

      var block = document.createElement('div');
      block.className = 'print-rf-line';

      var heading = document.createElement('h2');
      heading.textContent = 'Rollforward Request #' + (index + 1);
      block.appendChild(heading);

      function appendMetaRow(label, value) {
        var row = document.createElement('div');
        row.className = 'print-meta-row';
        var labelEl = document.createElement('span');
        labelEl.className = 'print-field-label';
        labelEl.textContent = label + ':';
        row.appendChild(labelEl);
        row.appendChild(document.createTextNode(' ' + value));
        block.appendChild(row);
      }

      appendMetaRow('Expense Account', accountNumber + (account.name ? ' - ' + account.name : ''));
      if (projCode) appendMetaRow('Project Number', projCode);
      if (contractPo) appendMetaRow('Contract or PO Number', contractPo);
      appendMetaRow('Amount', Calculations.formatCurrency(amount));

      var justificationLabel = document.createElement('div');
      justificationLabel.className = 'print-meta-row';
      var justificationLabelEl = document.createElement('span');
      justificationLabelEl.className = 'print-field-label';
      justificationLabelEl.textContent = 'Justification:';
      justificationLabel.appendChild(justificationLabelEl);
      block.appendChild(justificationLabel);

      var justificationText = document.createElement('div');
      justificationText.className = 'print-justification';
      justificationText.textContent = line.justificationInput.value.trim();
      block.appendChild(justificationText);

      printEls.lines.appendChild(block);
    });

    printEls.linesTotal.textContent = linesTotalEl.textContent;
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
    submissionModalBody.textContent = 'Your Rollforward Request has been submitted to the '
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

  // Chart of Accounts status never renders on the page — it's only
  // surfaced as a console.error in DevTools (Inspect -> Console), with
  // BudgetApp.refreshChartOfAccounts() exposed there as the manual retry
  // path since there's no on-page Refresh button anymore.
  function showCoaLoading() {
    coaStatusBanner.hidden = true;
  }

  function showCoaError(err) {
    coaStatusBanner.hidden = true;
    console.error(
      'Chart of Accounts: ' + (err && err.message ? err.message : 'Could not load the Chart of Accounts.')
      + ' Run BudgetApp.refreshChartOfAccounts() in the console to retry.'
    );
  }

  function showCoaLoaded(departmentCount, expenseCount) {
    coaStatusBanner.hidden = true;
    var message = 'Chart of Accounts loaded — '
      + departmentCount + ' department' + (departmentCount === 1 ? '' : 's') + ', '
      + expenseCount + ' expense account' + (expenseCount === 1 ? '' : 's') + '.'
      + ' Run BudgetApp.refreshChartOfAccounts() in the console to refresh.';
    console.error(message);
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

  printBtn.addEventListener('click', function () {
    populatePrintView();
    Print.printForm();
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

  window.BudgetApp.refreshChartOfAccounts = handleRefreshCoa;
})(
  window.BudgetApp.Calculations,
  window.BudgetApp.GoogleSheets,
  window.BudgetApp.Departments,
  window.BudgetApp.Expenses,
  window.BudgetApp.AccountSearch,
  window.BudgetApp.Validation,
  window.BudgetApp.Print,
  window.BudgetApp.Submission
);
