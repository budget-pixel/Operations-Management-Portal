/* =============================================================
   app.js
   Main entry point: DOM references, Transfer table row
   management, event wiring, and page initialization.

   Depends on (must load first): Calculations, Storage,
   Validation, Print — see index.html for load order.
   ============================================================= */

(function (Calculations, Storage, Validation, Print) {
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
    { input: document.getElementById('department'), error: document.getElementById('department-error'), message: 'Department is required.' },
    { input: document.getElementById('preparedBy'), error: document.getElementById('preparedBy-error'), message: 'Prepared By is required.' },
    { input: document.getElementById('title'), error: document.getElementById('title-error'), message: 'Title is required.' },
  ];

  // -----------------------------------------------------------
  // Transfer table row management
  // -----------------------------------------------------------

  // Builds one <tr> from the <template>, wiring up its input/remove listeners.
  function createRow(section) {
    var fragment = rowTemplate.content.cloneNode(true);
    var row = fragment.querySelector('.transfer-row');
    var accountInput = row.querySelector('.account-input');
    var amountInput = row.querySelector('.amount-input');
    var removeBtn = row.querySelector('.remove-row-btn');

    accountInput.addEventListener('input', function () {
      rowErrorEls[section].textContent = '';
      accountInput.removeAttribute('aria-invalid');
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
    tableBodies[section].appendChild(createRow(section));
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

    SECTIONS.forEach(function (section) {
      var rows = getRows(section);
      var result = Validation.validateTransferRows(rows, SECTION_LABELS[section]);
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
      accountNumber: row.querySelector('.account-input').value,
      amount: row.querySelector('.amount-input').value,
    };
  }

  function collectFormData() {
    var checkedRadio = amendmentRadios.filter(function (r) { return r.checked; })[0];

    return {
      date: document.getElementById('date').value,
      department: document.getElementById('department').value,
      description: document.getElementById('description').value,
      preparedBy: document.getElementById('preparedBy').value,
      title: document.getElementById('title').value,
      amendmentType: checkedRadio ? checkedRadio.value : '',
      transferFrom: getRows('transferFrom').map(rowToData),
      transferTo: getRows('transferTo').map(rowToData),
    };
  }

  function applyFormData(data) {
    document.getElementById('date').value = data.date || '';
    document.getElementById('department').value = data.department || '';
    document.getElementById('description').value = data.description || '';
    document.getElementById('preparedBy').value = data.preparedBy || '';
    document.getElementById('title').value = data.title || '';

    amendmentRadios.forEach(function (radio) {
      radio.checked = radio.value === data.amendmentType;
      radio.closest('.radio-option').classList.toggle('is-checked', radio.checked);
    });

    SECTIONS.forEach(function (section) {
      var rowsData = Array.isArray(data[section]) && data[section].length > 0
        ? data[section]
        : [{ accountNumber: '', amount: '' }];

      var body = tableBodies[section];
      body.innerHTML = '';
      rowsData.forEach(function (rowData) {
        var row = createRow(section);
        row.querySelector('.account-input').value = rowData.accountNumber || '';
        row.querySelector('.amount-input').value = rowData.amount || '';
        body.appendChild(row);
      });
      updateRemoveButtons(section);
      updateTotal(section);
    });
  }

  // -----------------------------------------------------------
  // Status banner
  // -----------------------------------------------------------

  function showStatus(variant, message) {
    statusBanner.className = 'banner no-print ' + variant;
    statusBanner.textContent = message;
    statusBanner.hidden = false;
  }

  function hideStatus() {
    statusBanner.hidden = true;
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

    // Automatically surface a saved draft, if one exists, for the user to restore.
    if (Storage.hasDraft()) {
      draftBanner.hidden = false;
    }
  }

  init();
})(
  window.BudgetApp.Calculations,
  window.BudgetApp.Storage,
  window.BudgetApp.Validation,
  window.BudgetApp.Print
);
