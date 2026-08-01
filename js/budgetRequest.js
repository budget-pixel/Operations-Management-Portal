/* =============================================================
   budgetRequest.js
   Page controller for budget-request.html — a department's full
   funding request for next fiscal year: New Staffing Requests,
   Current Vacancies, Operations, Contractual Services, and Capital
   Requests (New Vehicle / Replacement Vehicle / Equipment /
   Infrastructure, one Type dropdown rather than four sections).

   Five repeatable-line sections share the same add/remove/renumber/
   total housekeeping (createLineGroup() below) but each wires up its
   own field set via a createFields() callback — the shape of a
   staffing line, a vacancy, and a capital item are all different
   enough that a single shared template wouldn't fit. Operations and
   Contractual Services reuse the same searchable Expense Account
   combobox as Transfer/Rollforward (js/accountSearch.js, js/expenses.js),
   scoped to the one Department that governs the whole request.

   Unlike Rollforward/Transfer, every section here can be empty (a
   department might only have a Capital request this year) — the only
   form-level requirement is at least one line somewhere across all
   five sections.

   Depends on (must load first): Calculations, GoogleSheets,
   Departments, Expenses, AccountSearch, Validation, Print, Submission —
   see budget-request.html for load order.
   ============================================================= */

(function (Calculations, GoogleSheets, Departments, Expenses, AccountSearch, Validation, Print, Submission) {
  'use strict';

  var FISCAL_YEARS = ['2026-2027', '2027-2028'];
  var MAX_AMOUNT = Calculations.MAX_AMOUNT;

  // -----------------------------------------------------------
  // Element references
  // -----------------------------------------------------------

  var form = document.getElementById('budgetRequestForm');
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
    sections: document.getElementById('printSections'),
    grandTotal: document.getElementById('printGrandTotal'),
  };

  var departmentInput = document.getElementById('departmentInput');
  var departmentClearBtn = departmentInput.parentElement.querySelector('.combobox-clear');
  var departmentListbox = document.getElementById('departmentInput-listbox');
  var departmentErrorEl = document.getElementById('department-error');

  var fiscalYearSelect = document.getElementById('fiscalYearSelect');
  var fiscalYearErrorEl = document.getElementById('fiscalYear-error');

  var certificationInput = document.getElementById('certification');
  var certificationErrorEl = document.getElementById('certification-error');

  var grandTotalEl = document.getElementById('grandTotal');

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

  FISCAL_YEARS.forEach(function (year) {
    var option = document.createElement('option');
    option.value = year;
    option.textContent = year;
    fiscalYearSelect.appendChild(option);
  });

  // -----------------------------------------------------------
  // Shared repeatable-line-group factory — houses the add/remove/
  // renumber/total housekeeping every section below needs, so it's
  // written once instead of five times. Each section supplies its own
  // createFields(lineEl, uid) to wire up whatever inputs its template
  // has and return them as extra properties merged onto the line
  // object; computeAmount(line), if given, feeds a running total.
  // -----------------------------------------------------------

  function createLineGroup(opts) {
    var lines = [];

    function renumberLines() {
      lines.forEach(function (line, index) {
        line.titleEl.textContent = opts.titlePrefix + ' ' + (index + 1);
      });
    }

    function updateTotal() {
      if (!opts.totalEl || !opts.computeAmount) return;
      var total = lines.reduce(function (sum, line) {
        var amount = opts.computeAmount(line);
        return sum + (isFinite(amount) ? amount : 0);
      }, 0);
      opts.totalEl.textContent = Calculations.formatCurrency(total);
      updateGrandTotal();
    }

    function removeLine(line) {
      var index = lines.indexOf(line);
      if (index === -1) return;
      lines.splice(index, 1);
      line.el.remove();
      renumberLines();
      updateTotal();
    }

    function createLine() {
      var fragment = opts.templateEl.content.cloneNode(true);
      var lineEl = fragment.querySelector('.rollforward-line');
      var titleEl = lineEl.querySelector('.rollforward-line-title');
      var removeBtn = lineEl.querySelector('.remove-row-btn');
      var uid = opts.uidPrefix + '-' + Math.random().toString(36).slice(2);

      var line = { el: lineEl, titleEl: titleEl, removeBtn: removeBtn };
      var extra = opts.createFields(lineEl, uid, line) || {};
      Object.keys(extra).forEach(function (key) { line[key] = extra[key]; });

      removeBtn.addEventListener('click', function () { removeLine(line); });

      return line;
    }

    function addLine() {
      var line = createLine();
      opts.containerEl.appendChild(line.el);
      lines.push(line);
      renumberLines();
      updateTotal();
      return line;
    }

    function resetLines() {
      opts.containerEl.innerHTML = '';
      lines.length = 0;
      updateTotal();
    }

    if (opts.addBtnEl) {
      opts.addBtnEl.addEventListener('click', function () { addLine(); });
    }

    return {
      lines: lines,
      addLine: addLine,
      removeLine: removeLine,
      updateTotal: updateTotal,
      resetLines: resetLines,
    };
  }

  function updateGrandTotal() {
    var total = Calculations.parseAmount(newStaffingGroup ? stripCurrency(newStaffingTotalEl.textContent) : '0')
      + (operationsGroup ? Calculations.parseAmount(stripCurrency(operationsTotalEl.textContent)) : 0)
      + (contractualGroup ? Calculations.parseAmount(stripCurrency(contractualTotalEl.textContent)) : 0)
      + (capitalGroup ? Calculations.parseAmount(stripCurrency(capitalTotalEl.textContent)) : 0);
    grandTotalEl.textContent = Calculations.formatCurrency(total);
  }

  function stripCurrency(text) {
    return String(text || '0').replace(/[^0-9.]/g, '');
  }

  // -----------------------------------------------------------
  // Department (shared by Operations + Contractual Services accounts)
  // -----------------------------------------------------------

  var selectedDepartment = null;

  function getDeptMatchCode(dept) {
    if (!dept) return null;
    return dept.matchCode || dept.code || null;
  }

  function buildAccountNumber(account, projCode) {
    var parts = [selectedDepartment ? selectedDepartment.code : '', account.code];
    if (projCode) parts.push(projCode);
    return parts.filter(Boolean).join('-');
  }

  function buildAccountLabel(account, projCode) {
    return buildAccountNumber(account, projCode) + ' - ' + account.name;
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
      // Every Operations/Contractual line's account is scoped to the
      // department — a department change invalidates whatever was
      // selected on each one.
      [operationsGroup, contractualGroup].forEach(function (group) {
        if (!group) return;
        group.lines.forEach(function (line) {
          line.selectedAccount = null;
          line.accountController.clearSelection(false);
          line.accountController.setDisabled(!dept);
          line.accountInput.placeholder = dept ? 'Search account by number or name...' : 'Select a department first...';
        });
      });
    },
  });

  // -----------------------------------------------------------
  // Account-combobox field wiring shared by Operations + Contractual
  // Services — both need an Expense Account combobox scoped to
  // selectedDepartment, plus Project Number/Current FY Budget/Amount/
  // Justification. Factored out since only Contractual Services adds
  // one extra Vendor Name field on top.
  // -----------------------------------------------------------

  function wireAccountFields(lineEl, uid, line) {
    var accountInput = lineEl.querySelector('.account-input');
    var accountClearBtn = lineEl.querySelector('.combobox-clear');
    var accountListbox = lineEl.querySelector('.combobox-listbox');
    var accountErrorEl = lineEl.querySelector('.account-error');
    var projectInput = lineEl.querySelector('.project-input');
    var currentBudgetInput = lineEl.querySelector('.current-budget-input');
    var amountInput = lineEl.querySelector('.amount-input');
    var amountErrorEl = lineEl.querySelector('.amount-error');
    var justificationInput = lineEl.querySelector('.justification-input');
    var justificationErrorEl = lineEl.querySelector('.justification-error');

    accountInput.id = uid + '-account';
    accountListbox.id = uid + '-account-listbox';
    lineEl.querySelector('.line-account-label').setAttribute('for', accountInput.id);
    projectInput.id = uid + '-project';
    lineEl.querySelector('.line-project-label').setAttribute('for', projectInput.id);
    currentBudgetInput.id = uid + '-current-budget';
    lineEl.querySelector('.line-current-budget-label').setAttribute('for', currentBudgetInput.id);
    amountInput.id = uid + '-amount';
    lineEl.querySelector('.line-amount-label').setAttribute('for', amountInput.id);
    justificationInput.id = uid + '-justification';
    lineEl.querySelector('.line-justification-label').setAttribute('for', justificationInput.id);

    var fields = {
      accountInput: accountInput,
      accountErrorEl: accountErrorEl,
      projectInput: projectInput,
      currentBudgetInput: currentBudgetInput,
      amountInput: amountInput,
      amountErrorEl: amountErrorEl,
      justificationInput: justificationInput,
      justificationErrorEl: justificationErrorEl,
      selectedAccount: null,
    };

    function refreshLabel() {
      if (!fields.selectedAccount) return;
      var projCode = projectInput.value.trim();
      fields.accountController.setSelection({ label: buildAccountLabel(fields.selectedAccount, projCode) });
    }

    fields.accountController = AccountSearch.createCombobox({
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
          return { id: acct.code, label: buildAccountLabel(acct, projCode), data: acct };
        });
      },
      onSelect: function (account) {
        fields.selectedAccount = account;
        accountErrorEl.textContent = '';
        accountInput.removeAttribute('aria-invalid');
        if (account && account.projectCode) {
          projectInput.value = account.projectCode;
          projectInput.removeAttribute('aria-invalid');
          refreshLabel();
        }
      },
    });
    fields.accountController.setDisabled(!selectedDepartment);
    accountInput.placeholder = selectedDepartment ? 'Search account by number or name...' : 'Select a department first...';

    projectInput.addEventListener('input', function () {
      accountErrorEl.textContent = '';
      projectInput.removeAttribute('aria-invalid');
      refreshLabel();
    });

    currentBudgetInput.addEventListener('blur', function () {
      if (Calculations.isValidAmount(currentBudgetInput.value)) {
        currentBudgetInput.value = Calculations.parseAmount(currentBudgetInput.value).toFixed(2);
      }
    });

    amountInput.addEventListener('input', function () {
      Validation.setFieldError(amountInput, amountErrorEl, '');
      updateGrandTotalDeferred();
    });
    amountInput.addEventListener('blur', function () {
      if (Calculations.isValidAmount(amountInput.value)) {
        amountInput.value = Calculations.parseAmount(amountInput.value).toFixed(2);
      }
      updateGrandTotalDeferred();
    });

    justificationInput.addEventListener('input', function () {
      Validation.setFieldError(justificationInput, justificationErrorEl, '');
    });

    return fields;
  }

  // amountInput listeners above fire before the owning group variable
  // (operationsGroup/contractualGroup) exists on first call — deferred
  // via a plain function reference assigned once both groups are built.
  var updateGrandTotalDeferred = function () {};

  // -----------------------------------------------------------
  // New Staffing Requests
  // -----------------------------------------------------------

  var newStaffingTotalEl = document.getElementById('newStaffingTotal');

  var newStaffingGroup = createLineGroup({
    containerEl: document.getElementById('newStaffingLines'),
    templateEl: document.getElementById('newStaffingLineTemplate'),
    addBtnEl: document.getElementById('addNewStaffingBtn'),
    totalEl: newStaffingTotalEl,
    titlePrefix: 'New Position Request',
    uidPrefix: 'staff',
    computeAmount: function (line) {
      return Calculations.parseAmount(line.annualCostInput.value);
    },
    createFields: function (lineEl, uid) {
      var positionTitleInput = lineEl.querySelector('.position-title-input');
      var positionTitleErrorEl = lineEl.querySelector('.position-title-error');
      var positionCountInput = lineEl.querySelector('.position-count-input');
      var positionCountErrorEl = lineEl.querySelector('.position-count-error');
      var annualCostInput = lineEl.querySelector('.annual-cost-input');
      var annualCostErrorEl = lineEl.querySelector('.annual-cost-error');
      var justificationInput = lineEl.querySelector('.justification-input');
      var justificationErrorEl = lineEl.querySelector('.justification-error');

      positionTitleInput.id = uid + '-title';
      lineEl.querySelector('.line-position-title-label').setAttribute('for', positionTitleInput.id);
      positionCountInput.id = uid + '-count';
      lineEl.querySelector('.line-position-count-label').setAttribute('for', positionCountInput.id);
      annualCostInput.id = uid + '-cost';
      lineEl.querySelector('.line-annual-cost-label').setAttribute('for', annualCostInput.id);
      justificationInput.id = uid + '-justification';
      lineEl.querySelector('.line-justification-label').setAttribute('for', justificationInput.id);

      positionTitleInput.addEventListener('input', function () {
        Validation.setFieldError(positionTitleInput, positionTitleErrorEl, '');
      });
      positionCountInput.addEventListener('input', function () {
        Validation.setFieldError(positionCountInput, positionCountErrorEl, '');
      });
      annualCostInput.addEventListener('input', function () {
        Validation.setFieldError(annualCostInput, annualCostErrorEl, '');
        newStaffingGroup.updateTotal();
      });
      annualCostInput.addEventListener('blur', function () {
        if (Calculations.isValidAmount(annualCostInput.value)) {
          annualCostInput.value = Calculations.parseAmount(annualCostInput.value).toFixed(2);
          newStaffingGroup.updateTotal();
        }
      });
      justificationInput.addEventListener('input', function () {
        Validation.setFieldError(justificationInput, justificationErrorEl, '');
      });

      return {
        positionTitleInput: positionTitleInput,
        positionTitleErrorEl: positionTitleErrorEl,
        positionCountInput: positionCountInput,
        positionCountErrorEl: positionCountErrorEl,
        annualCostInput: annualCostInput,
        annualCostErrorEl: annualCostErrorEl,
        justificationInput: justificationInput,
        justificationErrorEl: justificationErrorEl,
      };
    },
  });

  // -----------------------------------------------------------
  // Current Vacancies — no dollar total; Time Vacant is computed from
  // Vacant Since to today whenever that date changes.
  // -----------------------------------------------------------

  function formatTimeVacant(vacantSinceValue) {
    if (!vacantSinceValue) return '';
    var since = new Date(vacantSinceValue + 'T00:00:00');
    if (isNaN(since.getTime())) return '';
    var now = new Date();
    var months = (now.getFullYear() - since.getFullYear()) * 12 + (now.getMonth() - since.getMonth());
    if (now.getDate() < since.getDate()) months -= 1;
    if (months < 0) return 'Not yet vacant';
    if (months < 1) return 'Less than 1 month';
    if (months < 12) return months + (months === 1 ? ' month' : ' months');
    var years = Math.floor(months / 12);
    var remMonths = months % 12;
    return years + (years === 1 ? ' year' : ' years') + (remMonths > 0 ? ', ' + remMonths + (remMonths === 1 ? ' month' : ' months') : '');
  }

  var vacancyGroup = createLineGroup({
    containerEl: document.getElementById('vacancyLines'),
    templateEl: document.getElementById('vacancyLineTemplate'),
    addBtnEl: document.getElementById('addVacancyBtn'),
    titlePrefix: 'Vacant Position',
    uidPrefix: 'vacancy',
    createFields: function (lineEl, uid) {
      var positionTitleInput = lineEl.querySelector('.position-title-input');
      var positionTitleErrorEl = lineEl.querySelector('.position-title-error');
      var positionNumberInput = lineEl.querySelector('.position-number-input');
      var vacantSinceInput = lineEl.querySelector('.vacant-since-input');
      var vacantSinceErrorEl = lineEl.querySelector('.vacant-since-error');
      var timeVacantDisplay = lineEl.querySelector('.time-vacant-display');
      var planToFillSelect = lineEl.querySelector('.plan-to-fill-select');
      var notesInput = lineEl.querySelector('.notes-input');

      positionTitleInput.id = uid + '-title';
      lineEl.querySelector('.line-position-title-label').setAttribute('for', positionTitleInput.id);
      positionNumberInput.id = uid + '-number';
      lineEl.querySelector('.line-position-number-label').setAttribute('for', positionNumberInput.id);
      vacantSinceInput.id = uid + '-vacant-since';
      lineEl.querySelector('.line-vacant-since-label').setAttribute('for', vacantSinceInput.id);
      timeVacantDisplay.id = uid + '-time-vacant';
      lineEl.querySelector('.line-time-vacant-label').setAttribute('for', timeVacantDisplay.id);
      planToFillSelect.id = uid + '-plan-to-fill';
      lineEl.querySelector('.line-plan-to-fill-label').setAttribute('for', planToFillSelect.id);
      notesInput.id = uid + '-notes';
      lineEl.querySelector('.line-notes-label').setAttribute('for', notesInput.id);

      positionTitleInput.addEventListener('input', function () {
        Validation.setFieldError(positionTitleInput, positionTitleErrorEl, '');
      });
      vacantSinceInput.addEventListener('input', function () {
        vacantSinceErrorEl.textContent = '';
        vacantSinceInput.removeAttribute('aria-invalid');
        timeVacantDisplay.value = formatTimeVacant(vacantSinceInput.value);
      });

      return {
        positionTitleInput: positionTitleInput,
        positionTitleErrorEl: positionTitleErrorEl,
        positionNumberInput: positionNumberInput,
        vacantSinceInput: vacantSinceInput,
        vacantSinceErrorEl: vacantSinceErrorEl,
        timeVacantDisplay: timeVacantDisplay,
        planToFillSelect: planToFillSelect,
        notesInput: notesInput,
      };
    },
  });

  // -----------------------------------------------------------
  // Operations
  // -----------------------------------------------------------

  var operationsTotalEl = document.getElementById('operationsTotal');

  var operationsGroup = createLineGroup({
    containerEl: document.getElementById('operationsLines'),
    templateEl: document.getElementById('operationsLineTemplate'),
    addBtnEl: document.getElementById('addOperationsBtn'),
    totalEl: operationsTotalEl,
    titlePrefix: 'Operating Line Item',
    uidPrefix: 'ops',
    computeAmount: function (line) {
      return Calculations.parseAmount(line.amountInput.value);
    },
    createFields: wireAccountFields,
  });

  // -----------------------------------------------------------
  // Contractual Services — same fields as Operations plus Vendor Name.
  // -----------------------------------------------------------

  var contractualTotalEl = document.getElementById('contractualTotal');

  var contractualGroup = createLineGroup({
    containerEl: document.getElementById('contractualLines'),
    templateEl: document.getElementById('contractualLineTemplate'),
    addBtnEl: document.getElementById('addContractualBtn'),
    totalEl: contractualTotalEl,
    titlePrefix: 'Contractual Service',
    uidPrefix: 'contract',
    computeAmount: function (line) {
      return Calculations.parseAmount(line.amountInput.value);
    },
    createFields: function (lineEl, uid, line) {
      var vendorInput = lineEl.querySelector('.vendor-input');
      vendorInput.id = uid + '-vendor';
      lineEl.querySelector('.line-vendor-label').setAttribute('for', vendorInput.id);

      var fields = wireAccountFields(lineEl, uid, line);
      fields.vendorInput = vendorInput;
      return fields;
    },
  });

  // -----------------------------------------------------------
  // Capital Requests — Type (New Vehicle / Replacement Vehicle /
  // Equipment / Infrastructure), Description, Quantity, Estimated Unit
  // Cost, and a computed Total Estimated Cost (Quantity × Unit Cost).
  // -----------------------------------------------------------

  var capitalTotalEl = document.getElementById('capitalTotal');

  var capitalGroup = createLineGroup({
    containerEl: document.getElementById('capitalLines'),
    templateEl: document.getElementById('capitalLineTemplate'),
    addBtnEl: document.getElementById('addCapitalBtn'),
    totalEl: capitalTotalEl,
    titlePrefix: 'Capital Item',
    uidPrefix: 'capital',
    computeAmount: function (line) {
      var qty = parseInt(line.quantityInput.value, 10);
      var unitCost = Calculations.parseAmount(line.unitCostInput.value);
      return (isFinite(qty) ? qty : 0) * unitCost;
    },
    createFields: function (lineEl, uid) {
      var typeSelect = lineEl.querySelector('.type-select');
      var typeErrorEl = lineEl.querySelector('.type-error');
      var descriptionInput = lineEl.querySelector('.description-input');
      var descriptionErrorEl = lineEl.querySelector('.description-error');
      var quantityInput = lineEl.querySelector('.quantity-input');
      var quantityErrorEl = lineEl.querySelector('.quantity-error');
      var unitCostInput = lineEl.querySelector('.unit-cost-input');
      var unitCostErrorEl = lineEl.querySelector('.unit-cost-error');
      var totalCostDisplay = lineEl.querySelector('.total-cost-display');
      var justificationInput = lineEl.querySelector('.justification-input');
      var justificationErrorEl = lineEl.querySelector('.justification-error');

      typeSelect.id = uid + '-type';
      lineEl.querySelector('.line-type-label').setAttribute('for', typeSelect.id);
      descriptionInput.id = uid + '-description';
      lineEl.querySelector('.line-description-label').setAttribute('for', descriptionInput.id);
      quantityInput.id = uid + '-quantity';
      lineEl.querySelector('.line-quantity-label').setAttribute('for', quantityInput.id);
      unitCostInput.id = uid + '-unit-cost';
      lineEl.querySelector('.line-unit-cost-label').setAttribute('for', unitCostInput.id);
      totalCostDisplay.id = uid + '-total-cost';
      lineEl.querySelector('.line-total-cost-label').setAttribute('for', totalCostDisplay.id);
      justificationInput.id = uid + '-justification';
      lineEl.querySelector('.line-justification-label').setAttribute('for', justificationInput.id);

      function refreshLineTotal() {
        var qty = parseInt(quantityInput.value, 10);
        var unitCost = Calculations.parseAmount(unitCostInput.value);
        var total = (isFinite(qty) ? qty : 0) * unitCost;
        totalCostDisplay.value = Calculations.formatCurrency(total);
        capitalGroup.updateTotal();
      }

      typeSelect.addEventListener('change', function () { typeErrorEl.textContent = ''; });
      descriptionInput.addEventListener('input', function () {
        Validation.setFieldError(descriptionInput, descriptionErrorEl, '');
      });
      quantityInput.addEventListener('input', function () {
        Validation.setFieldError(quantityInput, quantityErrorEl, '');
        refreshLineTotal();
      });
      unitCostInput.addEventListener('input', function () {
        Validation.setFieldError(unitCostInput, unitCostErrorEl, '');
        refreshLineTotal();
      });
      unitCostInput.addEventListener('blur', function () {
        if (Calculations.isValidAmount(unitCostInput.value)) {
          unitCostInput.value = Calculations.parseAmount(unitCostInput.value).toFixed(2);
          refreshLineTotal();
        }
      });
      justificationInput.addEventListener('input', function () {
        Validation.setFieldError(justificationInput, justificationErrorEl, '');
      });

      return {
        typeSelect: typeSelect,
        typeErrorEl: typeErrorEl,
        descriptionInput: descriptionInput,
        descriptionErrorEl: descriptionErrorEl,
        quantityInput: quantityInput,
        quantityErrorEl: quantityErrorEl,
        unitCostInput: unitCostInput,
        unitCostErrorEl: unitCostErrorEl,
        totalCostDisplay: totalCostDisplay,
        justificationInput: justificationInput,
        justificationErrorEl: justificationErrorEl,
      };
    },
  });

  // Now that every group exists, wire the deferred grand-total updater
  // used by Operations/Contractual's shared amountInput listeners.
  updateGrandTotalDeferred = updateGrandTotal;
  updateGrandTotal();

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

    function markInvalid(el) {
      isValid = false;
      firstInvalidEl = firstInvalidEl || el;
    }

    requiredFields.forEach(function (field) {
      if (!Validation.validateRequiredField(field.input, field.error, field.message)) markInvalid(field.input);
    });

    if (!Validation.validateEmailField(requesterEmailInput, requesterEmailErrorEl, 'Requester Email is required.', 'Enter a valid email address.')) {
      markInvalid(requesterEmailInput);
    }

    if (!Validation.validateDepartmentSelection(selectedDepartment, departmentErrorEl, 'Select a department.')) {
      markInvalid(departmentInput);
    }

    if (!fiscalYearSelect.value) {
      fiscalYearSelect.setAttribute('aria-invalid', 'true');
      fiscalYearErrorEl.textContent = 'Select a fiscal year.';
      markInvalid(fiscalYearSelect);
    } else {
      fiscalYearSelect.removeAttribute('aria-invalid');
      fiscalYearErrorEl.textContent = '';
    }

    newStaffingGroup.lines.forEach(function (line) {
      if (!Validation.validateRequiredField(line.positionTitleInput, line.positionTitleErrorEl, 'Position Title is required.')) {
        markInvalid(line.positionTitleInput);
      }
      if (!line.positionCountInput.value.trim() || parseInt(line.positionCountInput.value, 10) < 1) {
        Validation.setFieldError(line.positionCountInput, line.positionCountErrorEl, 'Enter a number of positions of at least 1.');
        markInvalid(line.positionCountInput);
      } else {
        Validation.setFieldError(line.positionCountInput, line.positionCountErrorEl, '');
      }
      if (!Calculations.isValidAmount(line.annualCostInput.value)) {
        Validation.setFieldError(line.annualCostInput, line.annualCostErrorEl, 'Enter a valid estimated annual cost.');
        markInvalid(line.annualCostInput);
      } else {
        Validation.setFieldError(line.annualCostInput, line.annualCostErrorEl, '');
      }
      if (!Validation.validateRequiredField(line.justificationInput, line.justificationErrorEl, 'Justification is required.')) {
        markInvalid(line.justificationInput);
      }
    });

    vacancyGroup.lines.forEach(function (line) {
      if (!Validation.validateRequiredField(line.positionTitleInput, line.positionTitleErrorEl, 'Position Title is required.')) {
        markInvalid(line.positionTitleInput);
      }
      if (!line.vacantSinceInput.value) {
        line.vacantSinceErrorEl.textContent = 'Vacant Since is required.';
        line.vacantSinceInput.setAttribute('aria-invalid', 'true');
        markInvalid(line.vacantSinceInput);
      } else {
        line.vacantSinceErrorEl.textContent = '';
        line.vacantSinceInput.removeAttribute('aria-invalid');
      }
    });

    [operationsGroup, contractualGroup].forEach(function (group) {
      group.lines.forEach(function (line) {
        if (!line.selectedAccount) {
          line.accountErrorEl.textContent = 'Select an expense account.';
          markInvalid(line.accountInput);
        } else {
          line.accountErrorEl.textContent = '';
        }
        if (!Calculations.isValidAmount(line.amountInput.value)) {
          Validation.setFieldError(line.amountInput, line.amountErrorEl, 'Enter a valid amount between 0.01 and ' + Calculations.formatCurrency(MAX_AMOUNT) + '.');
          markInvalid(line.amountInput);
        } else {
          Validation.setFieldError(line.amountInput, line.amountErrorEl, '');
        }
        if (!Validation.validateRequiredField(line.justificationInput, line.justificationErrorEl, 'Justification is required.')) {
          markInvalid(line.justificationInput);
        }
      });
    });

    capitalGroup.lines.forEach(function (line) {
      if (!line.typeSelect.value) {
        line.typeErrorEl.textContent = 'Select a type.';
        markInvalid(line.typeSelect);
      } else {
        line.typeErrorEl.textContent = '';
      }
      if (!Validation.validateRequiredField(line.descriptionInput, line.descriptionErrorEl, 'Description is required.')) {
        markInvalid(line.descriptionInput);
      }
      if (!line.quantityInput.value.trim() || parseInt(line.quantityInput.value, 10) < 1) {
        Validation.setFieldError(line.quantityInput, line.quantityErrorEl, 'Enter a quantity of at least 1.');
        markInvalid(line.quantityInput);
      } else {
        Validation.setFieldError(line.quantityInput, line.quantityErrorEl, '');
      }
      if (!Calculations.isValidAmount(line.unitCostInput.value)) {
        Validation.setFieldError(line.unitCostInput, line.unitCostErrorEl, 'Enter a valid estimated unit cost.');
        markInvalid(line.unitCostInput);
      } else {
        Validation.setFieldError(line.unitCostInput, line.unitCostErrorEl, '');
      }
      if (!Validation.validateRequiredField(line.justificationInput, line.justificationErrorEl, 'Justification is required.')) {
        markInvalid(line.justificationInput);
      }
    });

    var totalLineCount = newStaffingGroup.lines.length + vacancyGroup.lines.length
      + operationsGroup.lines.length + contractualGroup.lines.length + capitalGroup.lines.length;
    if (totalLineCount === 0) {
      markInvalid(null);
    }

    if (!Validation.validateCheckbox(certificationInput, certificationErrorEl, 'You must certify the request before submitting.')) {
      markInvalid(certificationInput);
    }

    return { isValid: isValid, firstInvalidEl: firstInvalidEl, isEmpty: totalLineCount === 0 };
  }

  // -----------------------------------------------------------
  // Collecting form data
  // -----------------------------------------------------------

  function collectAccountLine(line) {
    return {
      account: line.selectedAccount,
      projectCode: line.projectInput.value.trim(),
      currentFiscalYearBudget: line.currentBudgetInput.value.trim(),
      amount: line.amountInput.value,
      justification: line.justificationInput.value.trim(),
    };
  }

  function collectFormData() {
    return {
      requestType: 'budgetRequest',
      date: document.getElementById('date').value,
      requesterName: document.getElementById('requesterName').value.trim(),
      title: document.getElementById('title').value.trim(),
      requesterEmail: requesterEmailInput.value.trim(),
      department: selectedDepartment,
      fiscalYear: fiscalYearSelect.value,
      certified: certificationInput.checked,
      newStaffing: newStaffingGroup.lines.map(function (line) {
        return {
          positionTitle: line.positionTitleInput.value.trim(),
          numberOfPositions: line.positionCountInput.value.trim(),
          estimatedAnnualCost: line.annualCostInput.value,
          justification: line.justificationInput.value.trim(),
        };
      }),
      vacancies: vacancyGroup.lines.map(function (line) {
        return {
          positionTitle: line.positionTitleInput.value.trim(),
          positionNumber: line.positionNumberInput.value.trim(),
          vacantSince: line.vacantSinceInput.value,
          timeVacant: line.timeVacantDisplay.value,
          planToFill: line.planToFillSelect.value,
          notes: line.notesInput.value.trim(),
        };
      }),
      operations: operationsGroup.lines.map(collectAccountLine),
      contractualServices: contractualGroup.lines.map(function (line) {
        var data = collectAccountLine(line);
        data.vendorName = line.vendorInput.value.trim();
        return data;
      }),
      capital: capitalGroup.lines.map(function (line) {
        return {
          type: line.typeSelect.value,
          description: line.descriptionInput.value.trim(),
          quantity: line.quantityInput.value.trim(),
          unitCost: line.unitCostInput.value,
          totalCost: line.totalCostDisplay.value,
          justification: line.justificationInput.value.trim(),
        };
      }),
    };
  }

  // -----------------------------------------------------------
  // Print view
  // -----------------------------------------------------------

  function formatPrintDate(isoDate) {
    if (!isoDate) return '—';
    var parts = isoDate.split('-');
    return parts.length === 3 ? (parts[1] + '/' + parts[2] + '/' + parts[0]) : isoDate;
  }

  function appendMetaRow(block, label, value) {
    var row = document.createElement('div');
    row.className = 'print-meta-row';
    var labelEl = document.createElement('span');
    labelEl.className = 'print-field-label';
    labelEl.textContent = label + ':';
    row.appendChild(labelEl);
    row.appendChild(document.createTextNode(' ' + value));
    block.appendChild(row);
  }

  function appendPrintSection(container, heading, blocks) {
    if (blocks.length === 0) return;
    var sectionHeading = document.createElement('h2');
    sectionHeading.className = 'print-section-heading';
    sectionHeading.textContent = heading;
    container.appendChild(sectionHeading);
    blocks.forEach(function (block) { container.appendChild(block); });
  }

  function populatePrintView() {
    printEls.date.textContent = formatPrintDate(document.getElementById('date').value);
    printEls.requesterName.textContent = document.getElementById('requesterName').value.trim() || '—';
    printEls.title.textContent = document.getElementById('title').value.trim() || '—';
    printEls.requesterEmail.textContent = requesterEmailInput.value.trim() || '—';
    printEls.department.textContent = selectedDepartment ? (selectedDepartment.code + ' - ' + selectedDepartment.name) : '—';
    printEls.fiscalYear.textContent = fiscalYearSelect.value || '—';
    printEls.sections.innerHTML = '';

    appendPrintSection(printEls.sections, 'New Staffing Requests', newStaffingGroup.lines.map(function (line, index) {
      var block = document.createElement('div');
      block.className = 'print-rf-line';
      var h = document.createElement('h3');
      h.textContent = 'New Position Request ' + (index + 1);
      block.appendChild(h);
      appendMetaRow(block, 'Position Title', line.positionTitleInput.value.trim() || '—');
      appendMetaRow(block, 'Number of Positions', line.positionCountInput.value.trim() || '—');
      appendMetaRow(block, 'Estimated Annual Cost', Calculations.formatCurrency(Calculations.parseAmount(line.annualCostInput.value)));
      appendMetaRow(block, 'Justification', line.justificationInput.value.trim() || '—');
      return block;
    }));

    appendPrintSection(printEls.sections, 'Current Vacancies', vacancyGroup.lines.map(function (line, index) {
      var block = document.createElement('div');
      block.className = 'print-rf-line';
      var h = document.createElement('h3');
      h.textContent = 'Vacant Position ' + (index + 1);
      block.appendChild(h);
      appendMetaRow(block, 'Position Title', line.positionTitleInput.value.trim() || '—');
      if (line.positionNumberInput.value.trim()) appendMetaRow(block, 'Position Number', line.positionNumberInput.value.trim());
      appendMetaRow(block, 'Vacant Since', formatPrintDate(line.vacantSinceInput.value));
      appendMetaRow(block, 'Time Vacant', line.timeVacantDisplay.value || '—');
      appendMetaRow(block, 'Plan to Fill', line.planToFillSelect.value);
      if (line.notesInput.value.trim()) appendMetaRow(block, 'Notes', line.notesInput.value.trim());
      return block;
    }));

    function accountLineBlock(heading, line, index, extraRows) {
      var block = document.createElement('div');
      block.className = 'print-rf-line';
      var h = document.createElement('h3');
      h.textContent = heading + ' ' + (index + 1);
      block.appendChild(h);
      if (extraRows) extraRows(block);
      var account = line.selectedAccount || {};
      var accountNumber = buildAccountNumber(account, line.projectInput.value.trim());
      appendMetaRow(block, 'Expense Account', accountNumber + (account.name ? ' - ' + account.name : ''));
      if (line.projectInput.value.trim()) appendMetaRow(block, 'Project Number', line.projectInput.value.trim());
      if (line.currentBudgetInput.value.trim()) appendMetaRow(block, 'Current FY Budget', Calculations.formatCurrency(Calculations.parseAmount(line.currentBudgetInput.value)));
      appendMetaRow(block, 'Requested Amount', Calculations.formatCurrency(Calculations.parseAmount(line.amountInput.value)));
      appendMetaRow(block, 'Justification', line.justificationInput.value.trim() || '—');
      return block;
    }

    appendPrintSection(printEls.sections, 'Operations', operationsGroup.lines.map(function (line, index) {
      return accountLineBlock('Operating Line Item', line, index);
    }));

    appendPrintSection(printEls.sections, 'Contractual Services', contractualGroup.lines.map(function (line, index) {
      return accountLineBlock('Contractual Service', line, index, function (block) {
        if (line.vendorInput.value.trim()) appendMetaRow(block, 'Vendor / Contractor Name', line.vendorInput.value.trim());
      });
    }));

    appendPrintSection(printEls.sections, 'Capital Requests', capitalGroup.lines.map(function (line, index) {
      var block = document.createElement('div');
      block.className = 'print-rf-line';
      var h = document.createElement('h3');
      h.textContent = 'Capital Item ' + (index + 1);
      block.appendChild(h);
      appendMetaRow(block, 'Type', line.typeSelect.value || '—');
      appendMetaRow(block, 'Description', line.descriptionInput.value.trim() || '—');
      appendMetaRow(block, 'Quantity', line.quantityInput.value.trim() || '—');
      appendMetaRow(block, 'Estimated Unit Cost', Calculations.formatCurrency(Calculations.parseAmount(line.unitCostInput.value)));
      appendMetaRow(block, 'Total Estimated Cost', line.totalCostDisplay.value || '$0.00');
      appendMetaRow(block, 'Justification', line.justificationInput.value.trim() || '—');
      return block;
    }));

    printEls.grandTotal.textContent = grandTotalEl.textContent;
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

  function markSubmitted() {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitted';
  }

  function showSubmissionModal(requestId) {
    submissionModalBody.textContent = 'Your Budget Request has been submitted to the '
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
      .then(function () { return Promise.all([Departments.load(), Expenses.load()]); })
      .then(function (results) { showCoaLoaded(results[0].length, results[1].length); })
      .catch(function (err) { showCoaError(err); });
  }

  function loadChartOfAccounts() {
    showCoaLoading();
    return Promise.all([Departments.load(), Expenses.load()])
      .then(function (results) { showCoaLoaded(results[0].length, results[1].length); })
      .catch(function (err) { showCoaError(err); });
  }

  // -----------------------------------------------------------
  // Event wiring
  // -----------------------------------------------------------

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var result = validateForm();

    if (!result.isValid) {
      var message = result.isEmpty
        ? 'Add at least one item to at least one section before submitting.'
        : 'Please correct the highlighted fields before submitting.';
      showStatus('banner-error', message);
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
    [newStaffingGroup, vacancyGroup, operationsGroup, contractualGroup, capitalGroup].forEach(function (group) {
      group.resetLines();
    });
    setSubmitting(false);
    hideStatus();
  });

  // -----------------------------------------------------------
  // Init
  // -----------------------------------------------------------

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
