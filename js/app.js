/* =============================================================
   app.js
   Main entry point: DOM references, Chart of Accounts loading,
   department/account combobox wiring, Transfer table row
   management, event wiring, and page initialization.

   Depends on (must load first): Calculations, Storage,
   GoogleSheets, Departments, Expenses, Revenue, AccountSearch,
   Validation, AmendmentRules, Print — see index.html for load
   order.
   ============================================================= */

(function (Calculations, Storage, GoogleSheets, Departments, Expenses, Revenue, AccountSearch, Validation, AmendmentRules, Print) {
  'use strict';

  var INITIAL_ROW_COUNT = 5;
  var SECTIONS = ['transferFrom', 'transferTo'];
  var SECTION_LABELS = {
    transferFrom: 'Transfer From',
    transferTo: 'Transfer To',
  };

  // -----------------------------------------------------------
  // Element references
  // -----------------------------------------------------------

  var form = document.getElementById('budgetForm');
  var rowTemplate = document.getElementById('transferRowTemplate');
  var departmentTemplate = document.getElementById('departmentComboboxTemplate');

  var tableBodies = {
    transferFrom: document.getElementById('transferFromBody'),
    transferTo: document.getElementById('transferToBody'),
  };
  var totalEls = {
    transferFrom: document.getElementById('transferFromTotal'),
    transferTo: document.getElementById('transferToTotal'),
  };
  var rowErrorEls = {
    transferFrom: document.getElementById('transferFrom-error'),
    transferTo: document.getElementById('transferTo-error'),
  };

  var coaStatusBanner = document.getElementById('coaStatusBanner');
  var departmentFieldsContainer = document.getElementById('departmentFieldsContainer');

  var draftBanner = document.getElementById('draftBanner');
  var restoreDraftBtn = document.getElementById('restoreDraftBtn');
  var discardDraftBtn = document.getElementById('discardDraftBtn');
  var statusBanner = document.getElementById('statusBanner');

  var saveDraftBtn = document.getElementById('saveDraftBtn');
  var printBtn = document.getElementById('printBtn');
  var clearBtn = document.getElementById('clearBtn');

  var amendmentRadios = Array.prototype.slice.call(
    document.querySelectorAll('input[name="amendmentType"]')
  );
  var amendmentErrorEl = document.getElementById('amendmentType-error');

  var requiredFields = [
    { input: document.getElementById('date'), error: document.getElementById('date-error'), message: 'Date is required.' },
    { input: document.getElementById('preparedBy'), error: document.getElementById('preparedBy-error'), message: 'Prepared By is required.' },
    { input: document.getElementById('title'), error: document.getElementById('title-error'), message: 'Title is required.' },
  ];

  // -----------------------------------------------------------
  // Department selection state
  // -----------------------------------------------------------
  //
  // departmentMode is 'single' (Intradepartmental — one department governs
  // both Transfer From and Transfer To) or 'dual' (every other amendment
  // type — Transfer From and Transfer To each get their own department).

  var departmentMode = null;
  var departmentSelections = { single: null, from: null, to: null };
  var departmentControllers = {};

  // Prefers the normalized matchCode (see Code.gs's normalizeDeptCode) for
  // account filtering, but falls back to the padded display code if an
  // older deployed Apps Script hasn't been updated to send matchCode yet —
  // degrades to "still searchable" instead of hard-disabling the fields.
  function getDeptMatchCode(dept) {
    if (!dept) return null;
    return dept.matchCode || dept.code || null;
  }

  function getCurrentDepartmentCode(section) {
    if (departmentMode === AmendmentRules.SINGLE) {
      return getDeptMatchCode(departmentSelections.single);
    }
    if (departmentMode === AmendmentRules.DUAL) {
      var selection = section === 'transferFrom' ? departmentSelections.from : departmentSelections.to;
      return getDeptMatchCode(selection);
    }
    return null;
  }

  // The padded code as entered in the spreadsheet (e.g. "00107000") — used
  // to build the account number shown to the user, as opposed to
  // getCurrentDepartmentCode()'s normalized matchCode, which is only for
  // filtering.
  function getCurrentDepartmentDisplayCode(section) {
    if (departmentMode === AmendmentRules.SINGLE) {
      return departmentSelections.single ? departmentSelections.single.code : '';
    }
    if (departmentMode === AmendmentRules.DUAL) {
      var selection = section === 'transferFrom' ? departmentSelections.from : departmentSelections.to;
      return selection ? selection.code : '';
    }
    return '';
  }

  // Builds the full account number shown once an account is selected:
  // "DeptCode-ObjectCode[-ProjectCode] - Name" — e.g.
  // "00107000-531100-12345 - Office Supplies". Project code is optional.
  function buildAccountLabel(departmentDisplayCode, account, projectCode) {
    var numberParts = [departmentDisplayCode, account.code];
    if (projectCode) numberParts.push(projectCode);
    return numberParts.filter(Boolean).join('-') + ' - ' + account.name;
  }

  // Recomputes and re-displays a row's account label (e.g. after the
  // project code changes) without touching row._selectedAccount or firing
  // onSelect again.
  function refreshAccountLabel(row, section) {
    if (!row._selectedAccount) return;
    var departmentDisplayCode = getCurrentDepartmentDisplayCode(section);
    var projectCode = row.querySelector('.project-input').value.trim();
    var label = buildAccountLabel(departmentDisplayCode, row._selectedAccount, projectCode);
    row._accountController.setSelection({ label: label });
  }

  // Clones the department combobox template, wires it to Departments.search,
  // and appends it to departmentFieldsContainer.
  function mountDepartmentField(labelText, onSelectDepartment) {
    var fragment = departmentTemplate.content.cloneNode(true);
    var fieldEl = fragment.querySelector('.department-field');
    var labelEl = fieldEl.querySelector('.department-field-label');
    var inputEl = fieldEl.querySelector('.department-input');
    var clearBtn = fieldEl.querySelector('.combobox-clear');
    var listboxEl = fieldEl.querySelector('.combobox-listbox');
    var errorEl = fieldEl.querySelector('.department-error');

    var uid = 'dept-' + Math.random().toString(36).slice(2);
    inputEl.id = uid;
    labelEl.setAttribute('for', uid);
    labelEl.textContent = labelText;
    listboxEl.id = uid + '-listbox';
    errorEl.id = uid + '-error';

    departmentFieldsContainer.appendChild(fieldEl);

    var controller = AccountSearch.createCombobox({
      inputEl: inputEl,
      clearBtnEl: clearBtn,
      listboxEl: listboxEl,
      wrapperEl: fieldEl.querySelector('.combobox'),
      emptyMessage: 'No matching departments.',
      getResults: function (query) {
        return Departments.search(query).map(function (dept) {
          return { id: dept.code, label: dept.code + ' - ' + dept.name, data: dept };
        });
      },
      onSelect: function (dept) {
        errorEl.textContent = '';
        onSelectDepartment(dept);
      },
    });
    controller.inputEl = inputEl;
    controller.errorEl = errorEl;

    return controller;
  }

  // Renders the department field(s) that match the currently chosen
  // amendment type. Switching between two amendment types that share the
  // same department mode (e.g. Interdepartmental -> Reserve) leaves
  // existing department/account selections alone, since only the cited
  // statute changed, not where the money is moving.
  function renderDepartmentSection() {
    var checkedRadio = amendmentRadios.filter(function (r) { return r.checked; })[0];
    var newMode = checkedRadio ? AmendmentRules.getDepartmentMode(checkedRadio.value) : null;

    if (!newMode) {
      resetDepartmentSection();
      return;
    }

    if (newMode === departmentMode) return;

    buildDepartmentFields(newMode);
  }

  function buildDepartmentFields(mode) {
    departmentMode = mode;
    departmentFieldsContainer.innerHTML = '';
    departmentFieldsContainer.classList.toggle('grid-2', mode === AmendmentRules.DUAL);
    departmentSelections = { single: null, from: null, to: null };

    if (mode === AmendmentRules.SINGLE) {
      departmentControllers = {
        single: mountDepartmentField('Department', function (dept) {
          departmentSelections.single = dept;
          refreshAccountFilters('transferFrom', getDeptMatchCode(dept));
          refreshAccountFilters('transferTo', getDeptMatchCode(dept));
        }),
      };
    } else {
      departmentControllers = {
        from: mountDepartmentField('Transfer From Department', function (dept) {
          departmentSelections.from = dept;
          refreshAccountFilters('transferFrom', getDeptMatchCode(dept));
        }),
        to: mountDepartmentField('Transfer To Department', function (dept) {
          departmentSelections.to = dept;
          refreshAccountFilters('transferTo', getDeptMatchCode(dept));
        }),
      };
    }

    clearAllAccountSelections();
  }

  function resetDepartmentSection() {
    departmentMode = null;
    departmentControllers = {};
    departmentSelections = { single: null, from: null, to: null };
    departmentFieldsContainer.classList.remove('grid-2');
    departmentFieldsContainer.innerHTML = '';

    var hint = document.createElement('p');
    hint.className = 'field-hint';
    hint.id = 'departmentPlaceholderHint';
    hint.textContent = 'Select an amendment type above to choose the department(s) involved.';
    departmentFieldsContainer.appendChild(hint);

    clearAllAccountSelections();
  }

  // Points a row's account combobox at (or away from) a department, and
  // optionally clears whatever was previously selected in it.
  function applyRowDepartmentState(row, departmentCode, clearSelection) {
    row._departmentCode = departmentCode;
    if (clearSelection) {
      row._selectedAccount = null;
    }
    row._accountController.setDisabled(!departmentCode);
    row.querySelector('.account-input').placeholder = departmentCode
      ? 'Search account by number or name...'
      : 'Select a department first...';
  }

  // Disables and clears every row's account combobox in a section — used
  // whenever that section's governing department changes (including to
  // "no department"), per the "changing department clears the account"
  // requirement.
  function refreshAccountFilters(section, departmentCode) {
    getRows(section).forEach(function (row) {
      applyRowDepartmentState(row, departmentCode, true);
    });
  }

  function clearAllAccountSelections() {
    SECTIONS.forEach(function (section) {
      refreshAccountFilters(section, null);
    });
  }

  // -----------------------------------------------------------
  // Transfer table row management
  // -----------------------------------------------------------

  // Builds one <tr> from the <template>, wiring up its account combobox
  // (department-scoped, expense+revenue combined) and amount/remove
  // listeners.
  function createRow(section) {
    var fragment = rowTemplate.content.cloneNode(true);
    var row = fragment.querySelector('.transfer-row');
    var accountInput = row.querySelector('.account-input');
    var accountClearBtn = row.querySelector('.combobox-clear');
    var accountListbox = row.querySelector('.combobox-listbox');
    var projectInput = row.querySelector('.project-input');
    var amountInput = row.querySelector('.amount-input');
    var removeBtn = row.querySelector('.remove-row-btn');

    var uid = 'account-' + Math.random().toString(36).slice(2);
    accountInput.id = uid;
    accountListbox.id = uid + '-listbox';

    // The account combobox can only hold display text, so the resolved
    // selection (type/code/name/department) is stashed directly on the
    // row element — this is what validation.js and collectFormData read.
    row._departmentCode = null;
    row._selectedAccount = null;

    row._accountController = AccountSearch.createCombobox({
      inputEl: accountInput,
      clearBtnEl: accountClearBtn,
      listboxEl: accountListbox,
      wrapperEl: row.querySelector('.combobox'),
      emptyMessage: 'No matching accounts.',
      getResults: function (query) {
        var deptCode = row._departmentCode;
        if (!deptCode) return [];

        var departmentDisplayCode = getCurrentDepartmentDisplayCode(section);
        var projectCode = projectInput.value.trim();

        var expenseResults = Expenses.search(query, deptCode).map(function (acct) {
          var accountData = {
            type: 'expense',
            code: acct.code,
            name: acct.name,
            departmentCode: acct.departmentCode,
            departmentName: acct.departmentName,
          };
          return {
            id: 'expense-' + acct.code,
            label: buildAccountLabel(departmentDisplayCode, accountData, projectCode),
            group: 'Expense',
            data: accountData,
          };
        });
        var revenueResults = Revenue.search(query, deptCode).map(function (acct) {
          var accountData = {
            type: 'revenue',
            code: acct.code,
            name: acct.name,
            departmentCode: acct.departmentCode,
            departmentName: acct.departmentName,
          };
          return {
            id: 'revenue-' + acct.code,
            label: buildAccountLabel(departmentDisplayCode, accountData, projectCode),
            group: 'Revenue',
            data: accountData,
          };
        });
        return expenseResults.concat(revenueResults);
      },
      onSelect: function (account) {
        row._selectedAccount = account;
        rowErrorEls[section].textContent = '';
        accountInput.removeAttribute('aria-invalid');
      },
    });
    row._accountController.setDisabled(true);

    accountInput.addEventListener('input', function () {
      rowErrorEls[section].textContent = '';
    });

    // Project code doesn't change which account is selected, only how its
    // number is displayed — refresh the label in place, no re-selection.
    projectInput.addEventListener('input', function () {
      rowErrorEls[section].textContent = '';
      projectInput.removeAttribute('aria-invalid');
      refreshAccountLabel(row, section);
    });

    amountInput.addEventListener('input', function () {
      rowErrorEls[section].textContent = '';
      amountInput.removeAttribute('aria-invalid');
      updateTotal(section);
    });

    // Normalize the amount to two decimal places once the user leaves the field.
    amountInput.addEventListener('blur', function () {
      if (Calculations.isValidAmount(amountInput.value)) {
        amountInput.value = Calculations.parseAmount(amountInput.value).toFixed(2);
        updateTotal(section);
      }
    });

    removeBtn.addEventListener('click', function () {
      removeRow(section, row);
    });

    return row;
  }

  function addRow(section) {
    var row = createRow(section);
    tableBodies[section].appendChild(row);
    applyRowDepartmentState(row, getCurrentDepartmentCode(section), false);
    updateRemoveButtons(section);
    updateTotal(section);
  }

  // Keeps at least one row per table so the layout never collapses to nothing.
  function removeRow(section, rowEl) {
    if (tableBodies[section].children.length <= 1) return;
    rowEl.remove();
    updateRemoveButtons(section);
    updateTotal(section);
  }

  function updateRemoveButtons(section) {
    var body = tableBodies[section];
    var onlyOneRow = body.children.length <= 1;
    body.querySelectorAll('.remove-row-btn').forEach(function (btn) {
      btn.disabled = onlyOneRow;
    });
  }

  // Wipes and rebuilds a table with a fixed number of empty rows.
  function resetTable(section, rowCount) {
    var body = tableBodies[section];
    body.innerHTML = '';
    for (var i = 0; i < rowCount; i += 1) {
      body.appendChild(createRow(section));
    }
    updateRemoveButtons(section);
    updateTotal(section);
  }

  function updateTotal(section) {
    var amounts = Array.prototype.map.call(
      tableBodies[section].querySelectorAll('.amount-input'),
      function (input) { return input.value; }
    );
    totalEls[section].textContent = Calculations.formatCurrency(Calculations.sumAmounts(amounts));
  }

  function getRows(section) {
    return Array.prototype.slice.call(tableBodies[section].querySelectorAll('.transfer-row'));
  }

  // -----------------------------------------------------------
  // Live error clearing as the user types/selects
  // -----------------------------------------------------------

  requiredFields.forEach(function (field) {
    field.input.addEventListener('input', function () {
      Validation.setFieldError(field.input, field.error, '');
    });
  });

  amendmentRadios.forEach(function (radio) {
    radio.addEventListener('change', function () {
      amendmentRadios.forEach(function (r) {
        r.closest('.radio-option').classList.toggle('is-checked', r.checked);
      });
      amendmentErrorEl.textContent = '';
      renderDepartmentSection();
    });
  });

  // -----------------------------------------------------------
  // Form-wide validation (delegates the actual checks to Validation)
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

    var amendmentOk = Validation.validateAmendmentType(amendmentRadios, amendmentErrorEl);
    if (!amendmentOk) {
      isValid = false;
      firstInvalidEl = firstInvalidEl || amendmentRadios[0];
    }

    if (amendmentOk && departmentMode === AmendmentRules.SINGLE) {
      var singleOk = Validation.validateDepartmentSelection(
        departmentSelections.single, departmentControllers.single.errorEl, 'Select a department.'
      );
      if (!singleOk) {
        isValid = false;
        firstInvalidEl = firstInvalidEl || departmentControllers.single.inputEl;
      }
    } else if (amendmentOk && departmentMode === AmendmentRules.DUAL) {
      var fromOk = Validation.validateDepartmentSelection(
        departmentSelections.from, departmentControllers.from.errorEl, 'Select the Transfer From department.'
      );
      var toOk = Validation.validateDepartmentSelection(
        departmentSelections.to, departmentControllers.to.errorEl, 'Select the Transfer To department.'
      );
      if (!fromOk) {
        isValid = false;
        firstInvalidEl = firstInvalidEl || departmentControllers.from.inputEl;
      }
      if (!toOk) {
        isValid = false;
        firstInvalidEl = firstInvalidEl || departmentControllers.to.inputEl;
      }
    }

    SECTIONS.forEach(function (section) {
      var rows = getRows(section);
      var deptCode = getCurrentDepartmentCode(section);
      var result = Validation.validateTransferRows(rows, SECTION_LABELS[section], deptCode);
      rowErrorEls[section].textContent = result.message;
      if (!result.isValid) {
        isValid = false;
        firstInvalidEl = firstInvalidEl || rows[0].querySelector('.account-input');
      }
    });

    return { isValid: isValid, firstInvalidEl: firstInvalidEl };
  }

  // -----------------------------------------------------------
  // Collecting / applying form data (used by Save Draft / Restore Draft)
  // -----------------------------------------------------------

  function rowToData(row) {
    return {
      account: row._selectedAccount || null,
      projectCode: row.querySelector('.project-input').value.trim(),
      amount: row.querySelector('.amount-input').value,
    };
  }

  function collectFormData() {
    var checkedRadio = amendmentRadios.filter(function (r) { return r.checked; })[0];

    return {
      date: document.getElementById('date').value,
      description: document.getElementById('description').value,
      preparedBy: document.getElementById('preparedBy').value,
      title: document.getElementById('title').value,
      amendmentType: checkedRadio ? checkedRadio.value : '',
      department: departmentSelections.single,
      departmentFrom: departmentSelections.from,
      departmentTo: departmentSelections.to,
      transferFrom: getRows('transferFrom').map(rowToData),
      transferTo: getRows('transferTo').map(rowToData),
    };
  }

  // Restores state only (no clearing side effects) — the caller is
  // responsible for the ordering: department fields must exist before
  // their selections are applied, and department selections must be
  // applied before rows are rebuilt so each row picks up the right
  // governing department code.
  function applyDepartmentSelection(key, dept) {
    if (!dept) return;
    departmentSelections[key] = dept;
    var controller = departmentControllers[key];
    if (controller) controller.setSelection({ label: dept.code + ' - ' + dept.name });
  }

  function applyFormData(data) {
    document.getElementById('date').value = data.date || '';
    document.getElementById('description').value = data.description || '';
    document.getElementById('preparedBy').value = data.preparedBy || '';
    document.getElementById('title').value = data.title || '';

    amendmentRadios.forEach(function (radio) {
      radio.checked = radio.value === data.amendmentType;
      radio.closest('.radio-option').classList.toggle('is-checked', radio.checked);
    });

    var mode = AmendmentRules.getDepartmentMode(data.amendmentType);
    if (mode) {
      buildDepartmentFields(mode);
      if (mode === AmendmentRules.SINGLE) {
        applyDepartmentSelection('single', data.department);
      } else {
        applyDepartmentSelection('from', data.departmentFrom);
        applyDepartmentSelection('to', data.departmentTo);
      }
    } else {
      resetDepartmentSection();
    }

    SECTIONS.forEach(function (section) {
      var rowsData = Array.isArray(data[section]) && data[section].length > 0
        ? data[section]
        : [{ account: null, amount: '' }];

      var body = tableBodies[section];
      body.innerHTML = '';
      var deptCode = getCurrentDepartmentCode(section);

      rowsData.forEach(function (rowData) {
        var row = createRow(section);
        body.appendChild(row);
        applyRowDepartmentState(row, deptCode, false);

        row.querySelector('.project-input').value = rowData.projectCode || '';

        if (rowData.account) {
          row._selectedAccount = rowData.account;
          refreshAccountLabel(row, section);
        }
        row.querySelector('.amount-input').value = rowData.amount || '';
      });

      updateRemoveButtons(section);
      updateTotal(section);
    });
  }

  // -----------------------------------------------------------
  // Status banners
  // -----------------------------------------------------------

  function showStatus(variant, message) {
    statusBanner.className = 'banner no-print ' + variant;
    statusBanner.textContent = message;
    statusBanner.hidden = false;
  }

  function hideStatus() {
    statusBanner.hidden = true;
  }

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

  function showCoaLoaded() {
    showCoaBanner('banner-info', 'Chart of Accounts loaded.');
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
        return Promise.all([Departments.load(), Expenses.load(), Revenue.load()]);
      })
      .then(function () {
        // Existing selections are left as-is; only subsequent searches
        // (which read live from Departments/Expenses/Revenue) see the
        // refreshed data.
        showCoaLoaded();
      })
      .catch(function (err) {
        showCoaError(err);
      });
  }

  function loadChartOfAccounts() {
    showCoaLoading();
    return Promise.all([Departments.load(), Expenses.load(), Revenue.load()])
      .then(function () {
        showCoaLoaded();
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

    if (result.isValid) {
      showStatus('banner-success', 'Request validated and ready for submission. Use Print to generate a copy for signatures.');
    } else {
      showStatus('banner-error', 'Please correct the highlighted fields before submitting.');
      if (result.firstInvalidEl) {
        result.firstInvalidEl.focus();
        result.firstInvalidEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  });

  saveDraftBtn.addEventListener('click', function () {
    Storage.saveDraft(collectFormData());
    showStatus('banner-info', 'Draft saved at ' + new Date().toLocaleTimeString() + '.');
  });

  printBtn.addEventListener('click', function () {
    Print.printForm();
  });

  clearBtn.addEventListener('click', function () {
    var confirmed = window.confirm('Clear the form? Any unsaved changes will be lost.');
    if (!confirmed) return;

    form.reset();
    requiredFields.forEach(function (field) { Validation.setFieldError(field.input, field.error, ''); });
    amendmentErrorEl.textContent = '';
    amendmentRadios.forEach(function (r) { r.closest('.radio-option').classList.remove('is-checked'); });
    resetDepartmentSection();
    SECTIONS.forEach(function (section) { resetTable(section, INITIAL_ROW_COUNT); });
    hideStatus();
  });

  document.querySelectorAll('.add-row-btn').forEach(function (btn) {
    btn.addEventListener('click', function () { addRow(btn.dataset.section); });
  });

  restoreDraftBtn.addEventListener('click', function () {
    var data = Storage.loadDraft();
    if (data) applyFormData(data);
    draftBanner.hidden = true;
  });

  discardDraftBtn.addEventListener('click', function () {
    Storage.clearDraft();
    draftBanner.hidden = true;
  });

  // -----------------------------------------------------------
  // Init — runs as soon as this script executes (placed at end of <body>)
  // -----------------------------------------------------------

  function init() {
    SECTIONS.forEach(function (section) { resetTable(section, INITIAL_ROW_COUNT); });

    // Syncs the department section with whatever radio state actually
    // exists right now (defensive — covers browsers that restore form
    // state on reload without firing 'change' events).
    renderDepartmentSection();

    loadChartOfAccounts();

    // Automatically surface a saved draft, if one exists, for the user to restore.
    if (Storage.hasDraft()) {
      draftBanner.hidden = false;
    }
  }

  init();
})(
  window.BudgetApp.Calculations,
  window.BudgetApp.Storage,
  window.BudgetApp.GoogleSheets,
  window.BudgetApp.Departments,
  window.BudgetApp.Expenses,
  window.BudgetApp.Revenue,
  window.BudgetApp.AccountSearch,
  window.BudgetApp.Validation,
  window.BudgetApp.AmendmentRules,
  window.BudgetApp.Print
);
