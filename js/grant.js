/* =============================================================
   grant.js
   Page controller for grant.html — DOM wiring, validation, and
   submission for the Grant Amendment Request workflow.

   Unlike Transfer/Rollforward, the Revenue and Expense accounts
   here are never searched from the Chart of Accounts — they're
   computed directly from four choices (Grant Source, Activity,
   Department, Category) plus the entered Amount and an optional
   Grant Number:

   - Expense Account  = Department Code + Category's object code
                         + Grant Number
                         (Equipment 564000, Construction 563000,
                         Design 531000, Salaries 512000, Other 534000)

   - Revenue Account   = [Fund + Grant Type code] + [Grant Type code
                         + Activity code] + Grant Number
                         (Fund is the first 3 digits of the
                         Department Code; Grant Type code is 331 for
                         Federal or 334 for State — e.g. selecting
                         State + Activity 500 under Department
                         "00107010" produces "001334-334500".)

   ACTIVITY_CODES is the Florida Accounting Manual's (Rule
   69I-51.0012, F.A.C.) 331.xxx (Federal Grants) / 334.xxx (State
   Grants) revenue account series.

   Depends on (must load first): Calculations, GoogleSheets,
   Departments, AccountSearch, Validation, Print, Submission — see
   grant.html for load order.
   ============================================================= */

(function (Calculations, GoogleSheets, Departments, AccountSearch, Validation, Print, Submission) {
  'use strict';

  // Object code each amendment category posts to on the expense side.
  var CATEGORY_OBJECT_CODES = {
    equipment: '564000',
    construction: '563000',
    design: '531000',
    salaries: '512000',
    other: '534000',
  };

  var CATEGORY_LABELS = {
    equipment: 'Equipment',
    construction: 'Construction',
    design: 'Design',
    salaries: 'Salaries',
    other: 'Other',
  };

  // 331 (Federal) / 334 (State) — both the revenue "department" prefix
  // (paired with the fund) and the revenue object code prefix (paired
  // with the activity code).
  var GRANT_TYPE_CODES = {
    federal: '331',
    state: '334',
  };

  var GRANT_SOURCE_LABELS = {
    federal: 'Federal Grant',
    state: 'State Grant',
  };

  // Fund code (the first 3 digits of a department's account code) -> the
  // fund name used on the Grant Resolution (e.g. "the Solid Waste Fund").
  // Falls back to "Fund {code}" for any fund not listed here.
  var FUND_NAMES = {
    '001': 'General Fund',
    '101': 'Transportation Fund',
    '103': 'Building Fund',
    '105': 'Mosquito Control Fund',
    '111': 'Tourist Development Fund',
    '112': 'Solid Waste Fund',
  };

  function getFundName(departmentCode) {
    var fund = String(departmentCode || '').slice(0, 3);
    return FUND_NAMES[fund] || ('Fund ' + fund);
  }

  // Florida Accounting Manual (Rule 69I-51.0012, F.A.C., revised 01/2022)
  // — Federal Grants (331.xxx) and State Grants (334.xxx) revenue account
  // activity codes. Kept as the exact code + description pairs from the
  // manual so the dropdown reads the same as the source document.
  var ACTIVITY_CODES = {
    federal: [
      { code: '100', label: 'General Government' },
      { code: '200', label: 'Public Safety' },
      { code: '310', label: 'Water Supply System' },
      { code: '320', label: 'Electric Supply System' },
      { code: '330', label: 'Gas Supply System' },
      { code: '340', label: 'Garbage/Solid Waste' },
      { code: '350', label: 'Sewer/Wastewater' },
      { code: '390', label: 'Other Physical Environment' },
      { code: '410', label: 'Airport Development' },
      { code: '420', label: 'Mass Transit' },
      { code: '490', label: 'Other Transportation' },
      { code: '500', label: 'Economic Environment' },
      { code: '510', label: 'ARPA Funds' },
      { code: '610', label: 'Health or Hospitals' },
      { code: '620', label: 'Public Assistance' },
      { code: '650', label: 'Child Support Reimbursement' },
      { code: '690', label: 'Other Human Services' },
      { code: '700', label: 'Culture/Recreation' },
      { code: '810', label: 'Process Servers' },
      { code: '820', label: 'Drug Court Management' },
      { code: '830', label: 'Hearing Officer' },
      { code: '890', label: 'Other Court-Related Grants' },
      { code: '900', label: 'Other Federal Grants' },
    ],
    state: [
      { code: '100', label: 'General Government' },
      { code: '200', label: 'Public Safety' },
      { code: '310', label: 'Water Supply System' },
      { code: '320', label: 'Electric Supply System' },
      { code: '330', label: 'Gas Supply System' },
      { code: '340', label: 'Garbage/Solid Waste' },
      { code: '350', label: 'Sewer/Wastewater' },
      { code: '360', label: 'Stormwater Management' },
      { code: '390', label: 'Other Physical Environment' },
      { code: '410', label: 'Airport Development' },
      { code: '420', label: 'Mass Transit' },
      { code: '490', label: 'Other Transportation' },
      { code: '500', label: 'Economic Environment' },
      { code: '610', label: 'Health or Hospitals' },
      { code: '620', label: 'Public Welfare' },
      { code: '690', label: 'Other Human Services' },
      { code: '700', label: 'Culture/Recreation' },
      { code: '810', label: 'Conflict Cases' },
      { code: '820', label: 'County Article V Trust Fund' },
      { code: '830', label: 'Child Dependency' },
      { code: '890', label: 'Other Court-Related' },
      { code: '900', label: 'Other' },
    ],
  };

  // -----------------------------------------------------------
  // Element references
  // -----------------------------------------------------------

  var form = document.getElementById('grantForm');
  var coaStatusBanner = document.getElementById('coaStatusBanner');
  var statusBanner = document.getElementById('statusBanner');

  var submitBtn = document.getElementById('submitBtn');
  var printBtn = document.getElementById('printBtn');
  var clearBtn = document.getElementById('clearBtn');
  var generateResolutionBtn = document.getElementById('generateResolutionBtn');
  var submitBtnDefaultLabel = submitBtn.textContent;

  // -----------------------------------------------------------
  // Grant agreement gate — must be answered "Yes" (with a Board approval
  // date) before #formBody is revealed. See evaluateGate() below.
  // -----------------------------------------------------------

  var formBody = document.getElementById('formBody');
  var agreementRadios = Array.prototype.slice.call(document.querySelectorAll('input[name="agreementApproved"]'));
  var agreementErrorEl = document.getElementById('agreementApproved-error');
  var agreementNoBanner = document.getElementById('agreementNoBanner');
  var boardApprovalDateField = document.getElementById('boardApprovalDateField');
  var boardApprovalDateInput = document.getElementById('boardApprovalDate');
  var boardApprovalDateErrorEl = document.getElementById('boardApprovalDate-error');

  function evaluateGate() {
    var answer = getCheckedRadioValue(agreementRadios);

    agreementNoBanner.hidden = answer !== 'no';
    boardApprovalDateField.hidden = answer !== 'yes';
    if (answer !== 'yes') {
      boardApprovalDateInput.value = '';
      Validation.setFieldError(boardApprovalDateInput, boardApprovalDateErrorEl, '');
    }

    var shouldReveal = answer === 'yes' && !!boardApprovalDateInput.value;
    formBody.hidden = !shouldReveal;
  }

  agreementRadios.forEach(function (radio) {
    radio.addEventListener('change', function () {
      agreementErrorEl.textContent = '';
      agreementRadios.forEach(function (r) { r.closest('.radio-option').classList.toggle('is-checked', r.checked); });
      evaluateGate();
    });
  });

  boardApprovalDateInput.addEventListener('input', function () {
    boardApprovalDateErrorEl.textContent = '';
    boardApprovalDateInput.removeAttribute('aria-invalid');
    evaluateGate();
  });

  var grantSourceRadios = Array.prototype.slice.call(document.querySelectorAll('input[name="grantSource"]'));
  var grantSourceErrorEl = document.getElementById('grantSource-error');

  var activityCodeInput = document.getElementById('activityCodeInput');
  var activityClearBtn = activityCodeInput.parentElement.querySelector('.combobox-clear');
  var activityListbox = document.getElementById('activityCodeInput-listbox');
  var activityCodeErrorEl = document.getElementById('activityCode-error');

  var departmentInput = document.getElementById('departmentInput');
  var departmentClearBtn = departmentInput.parentElement.querySelector('.combobox-clear');
  var departmentListbox = document.getElementById('departmentInput-listbox');
  var departmentErrorEl = document.getElementById('department-error');

  var categoryRadios = Array.prototype.slice.call(document.querySelectorAll('input[name="category"]'));
  var categoryErrorEl = document.getElementById('category-error');

  var amountInput = document.getElementById('amount');
  var amountErrorEl = document.getElementById('amount-error');
  var grantNumberInput = document.getElementById('grantNumber');
  var grantNumberErrorEl = document.getElementById('grantNumber-error');

  var revenuePreview = {
    number: document.getElementById('revenueAccountNumber'),
    desc: document.getElementById('revenueAccountDesc'),
    amount: document.getElementById('revenueAccountAmount'),
  };
  var expensePreview = {
    number: document.getElementById('expenseAccountNumber'),
    desc: document.getElementById('expenseAccountDesc'),
    amount: document.getElementById('expenseAccountAmount'),
  };

  var grantingAgencyInput = document.getElementById('grantingAgency');
  var grantingAgencyErrorEl = document.getElementById('grantingAgency-error');
  var grantProgramNameInput = document.getElementById('grantProgramName');
  var grantProgramNameErrorEl = document.getElementById('grantProgramName-error');

  var requiredFields = [
    { input: document.getElementById('preparedBy'), error: document.getElementById('preparedBy-error'), message: 'Prepared By is required.' },
    { input: document.getElementById('title'), error: document.getElementById('title-error'), message: 'Title is required.' },
    { input: grantingAgencyInput, error: grantingAgencyErrorEl, message: 'Granting Agency is required.' },
    { input: grantProgramNameInput, error: grantProgramNameErrorEl, message: 'Grant Program Name is required.' },
  ];
  var requestorEmailInput = document.getElementById('requestorEmail');
  var requestorEmailErrorEl = document.getElementById('requestorEmail-error');

  var submissionModal = document.getElementById('submissionModal');
  var submissionModalBody = document.getElementById('submissionModalBody');
  var submissionModalCloseBtn = document.getElementById('submissionModalCloseBtn');

  var printView = document.getElementById('printView');
  var resolutionPrintView = document.getElementById('resolutionPrintView');
  // Only #printView prints by default (e.g. a manual Ctrl+P) until one of
  // the two print buttons below sets this explicitly.
  resolutionPrintView.style.display = 'none';

  var printEls = {
    preparedBy: document.getElementById('printPreparedBy'),
    title: document.getElementById('printTitle'),
    requestorEmail: document.getElementById('printRequestorEmail'),
    grantSource: document.getElementById('printGrantSource'),
    activity: document.getElementById('printActivity'),
    department: document.getElementById('printDepartment'),
    grantingAgency: document.getElementById('printGrantingAgency'),
    grantProgramName: document.getElementById('printGrantProgramName'),
    boardApprovalDate: document.getElementById('printBoardApprovalDate'),
    grantNumber: document.getElementById('printGrantNumber'),
    revenueBody: document.getElementById('printRevenueBody'),
    expenseBody: document.getElementById('printExpenseBody'),
  };

  var resolutionEls = {
    number: document.getElementById('resolutionNumber'),
    title: document.getElementById('resolutionTitle'),
    whereas: document.getElementById('resolutionWhereas'),
    resolved: document.getElementById('resolutionResolved'),
    adopted: document.getElementById('resolutionAdopted'),
  };

  var selectedDepartment = null;
  var selectedActivity = null;
  var currentGrantSource = '';

  // -----------------------------------------------------------
  // Account number computation (see file header for the formula)
  // -----------------------------------------------------------

  function getCheckedRadioValue(radios) {
    var checked = radios.filter(function (r) { return r.checked; })[0];
    return checked ? checked.value : '';
  }

  function buildExpenseAccountNumber(department, category, grantNumber) {
    if (!department || !category) return null;
    var objectCode = CATEGORY_OBJECT_CODES[category];
    if (!objectCode) return null;
    return [department.code, objectCode, grantNumber].filter(Boolean).join('-');
  }

  function buildRevenueAccountNumber(department, grantSource, activityCode, grantNumber) {
    if (!department || !grantSource || !activityCode) return null;
    var typeCode = GRANT_TYPE_CODES[grantSource];
    if (!typeCode) return null;
    var fund = department.code.slice(0, 3);
    var revenueDeptCode = fund + typeCode;
    var revenueObjectCode = typeCode + activityCode;
    return [revenueDeptCode, revenueObjectCode, grantNumber].filter(Boolean).join('-');
  }

  function updateAccountPreviews() {
    var grantSource = getCheckedRadioValue(grantSourceRadios);
    var activityCode = selectedActivity ? selectedActivity.code : '';
    var category = getCheckedRadioValue(categoryRadios);
    var grantNumber = grantNumberInput.value.trim();
    var amount = Calculations.isValidAmount(amountInput.value) ? Calculations.parseAmount(amountInput.value) : 0;
    var amountText = Calculations.formatCurrency(amount);

    var revenueNumber = buildRevenueAccountNumber(selectedDepartment, grantSource, activityCode, grantNumber);
    revenuePreview.number.textContent = revenueNumber || '—';
    revenuePreview.desc.textContent = grantSource && selectedActivity
      ? (GRANT_SOURCE_LABELS[grantSource] + ' — ' + selectedActivity.label)
      : '';
    revenuePreview.amount.textContent = amountText;

    var expenseNumber = buildExpenseAccountNumber(selectedDepartment, category, grantNumber);
    expensePreview.number.textContent = expenseNumber || '—';
    expensePreview.desc.textContent = category ? CATEGORY_LABELS[category] : '';
    expensePreview.amount.textContent = amountText;
  }

  // -----------------------------------------------------------
  // Grant Source -> Activity (a searchable combobox, exactly like
  // Department, rather than a native <select> — populated from
  // ACTIVITY_CODES[currentGrantSource] instead of the Chart of Accounts).
  // -----------------------------------------------------------

  var activityController = AccountSearch.createCombobox({
    inputEl: activityCodeInput,
    clearBtnEl: activityClearBtn,
    listboxEl: activityListbox,
    wrapperEl: activityCodeInput.closest('.combobox'),
    emptyMessage: 'No matching activities.',
    getResults: function (query) {
      var entries = ACTIVITY_CODES[currentGrantSource] || [];
      var typeCode = GRANT_TYPE_CODES[currentGrantSource] || '';
      var q = String(query || '').trim().toLowerCase();
      return entries
        .filter(function (entry) {
          if (!q) return true;
          return (typeCode + '.' + entry.code).toLowerCase().indexOf(q) !== -1
            || entry.label.toLowerCase().indexOf(q) !== -1;
        })
        .map(function (entry) {
          return { id: entry.code, label: entry.label, data: entry };
        });
    },
    onSelect: function (activity) {
      activityCodeErrorEl.textContent = '';
      activityCodeInput.removeAttribute('aria-invalid');
      selectedActivity = activity;
      updateAccountPreviews();
    },
  });

  function resetActivitySelection(grantSource) {
    currentGrantSource = grantSource;
    activityController.clearSelection(false);
    selectedActivity = null;
    var hasEntries = !!(ACTIVITY_CODES[grantSource] && ACTIVITY_CODES[grantSource].length);
    activityController.setDisabled(!hasEntries);
    activityCodeInput.placeholder = hasEntries ? 'Search or select an activity...' : 'Select a grant source first...';
  }

  grantSourceRadios.forEach(function (radio) {
    radio.addEventListener('change', function () {
      grantSourceErrorEl.textContent = '';
      grantSourceRadios.forEach(function (r) { r.closest('.radio-option').classList.toggle('is-checked', r.checked); });
      resetActivitySelection(radio.value);
      activityCodeErrorEl.textContent = '';
      updateAccountPreviews();
    });
  });

  categoryRadios.forEach(function (radio) {
    radio.addEventListener('change', function () {
      categoryErrorEl.textContent = '';
      categoryRadios.forEach(function (r) { r.closest('.radio-option').classList.toggle('is-checked', r.checked); });
      updateAccountPreviews();
    });
  });

  amountInput.addEventListener('input', function () {
    Validation.setFieldError(amountInput, amountErrorEl, '');
    updateAccountPreviews();
  });

  amountInput.addEventListener('blur', function () {
    if (Calculations.isValidAmount(amountInput.value)) {
      amountInput.value = Calculations.parseAmount(amountInput.value).toFixed(2);
      updateAccountPreviews();
    }
  });

  grantNumberInput.addEventListener('input', function () {
    grantNumberErrorEl.textContent = '';
    grantNumberInput.removeAttribute('aria-invalid');
    updateAccountPreviews();
  });

  // -----------------------------------------------------------
  // Department
  // -----------------------------------------------------------

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
      updateAccountPreviews();
    },
  });

  // -----------------------------------------------------------
  // Chart of Accounts loading — status never renders on the page, only
  // as a console.error in DevTools (Inspect -> Console), with
  // BudgetApp.refreshChartOfAccounts() exposed there as the manual
  // retry path since there's no on-page Refresh button.
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

  function showCoaLoaded(departmentCount) {
    coaStatusBanner.hidden = true;
    console.error(
      'Chart of Accounts loaded — ' + departmentCount + ' department' + (departmentCount === 1 ? '' : 's') + '.'
      + ' Run BudgetApp.refreshChartOfAccounts() in the console to refresh.'
    );
  }

  function handleRefreshCoa() {
    showCoaLoading();
    GoogleSheets.refresh()
      .then(function () { return Departments.load(); })
      .then(function (results) { showCoaLoaded(results.length); })
      .catch(function (err) { showCoaError(err); });
  }

  function loadChartOfAccounts() {
    showCoaLoading();
    return Departments.load()
      .then(function (results) { showCoaLoaded(results.length); })
      .catch(function (err) { showCoaError(err); });
  }

  // -----------------------------------------------------------
  // Validation
  // -----------------------------------------------------------

  // Grant Number is optional, but when present must be a plain 5-digit
  // number in the 10000-99999 range — mirrors Transfer/Rollforward's
  // Project Number rule.
  function isValidGrantNumber(value) {
    return /^[0-9]{5}$/.test(value) && Number(value) >= 10000 && Number(value) <= 99999;
  }

  function validateForm() {
    var isValid = true;
    var firstInvalidEl = null;

    var agreementOk = Validation.validateAmendmentType(agreementRadios, agreementErrorEl);
    if (!agreementOk) {
      isValid = false;
      firstInvalidEl = firstInvalidEl || agreementRadios[0];
    } else if (getCheckedRadioValue(agreementRadios) === 'no') {
      // A "No" is itself a valid answer to the gate question, but it means
      // the request can never be submitted — formBody stays hidden, so
      // there's nothing further to validate or reach Submit from.
      isValid = false;
      firstInvalidEl = firstInvalidEl || agreementRadios[0];
    } else if (!boardApprovalDateInput.value) {
      boardApprovalDateInput.setAttribute('aria-invalid', 'true');
      boardApprovalDateErrorEl.textContent = 'Select when the Board will approve the grant agreement.';
      isValid = false;
      firstInvalidEl = firstInvalidEl || boardApprovalDateInput;
    } else {
      boardApprovalDateInput.removeAttribute('aria-invalid');
      boardApprovalDateErrorEl.textContent = '';
    }

    requiredFields.forEach(function (field) {
      var ok = Validation.validateRequiredField(field.input, field.error, field.message);
      if (!ok) {
        isValid = false;
        firstInvalidEl = firstInvalidEl || field.input;
      }
    });

    var emailOk = Validation.validateEmailField(
      requestorEmailInput, requestorEmailErrorEl,
      'Requestor Email Address is required.', 'Enter a valid email address.'
    );
    if (!emailOk) {
      isValid = false;
      firstInvalidEl = firstInvalidEl || requestorEmailInput;
    }

    var grantSourceOk = Validation.validateAmendmentType(grantSourceRadios, grantSourceErrorEl);
    if (!grantSourceOk) {
      isValid = false;
      firstInvalidEl = firstInvalidEl || grantSourceRadios[0];
    }

    if (!selectedActivity) {
      activityCodeInput.setAttribute('aria-invalid', 'true');
      activityCodeErrorEl.textContent = 'Select the grant activity.';
      isValid = false;
      firstInvalidEl = firstInvalidEl || activityCodeInput;
    } else {
      activityCodeInput.removeAttribute('aria-invalid');
      activityCodeErrorEl.textContent = '';
    }

    var deptOk = Validation.validateDepartmentSelection(selectedDepartment, departmentErrorEl, 'Select a department.');
    if (!deptOk) {
      isValid = false;
      firstInvalidEl = firstInvalidEl || departmentInput;
    }

    var categoryOk = Validation.validateAmendmentType(categoryRadios, categoryErrorEl);
    if (!categoryOk) {
      isValid = false;
      firstInvalidEl = firstInvalidEl || categoryRadios[0];
    }

    if (!Calculations.isValidAmount(amountInput.value)) {
      Validation.setFieldError(
        amountInput, amountErrorEl,
        'Enter a valid amount between 0.01 and ' + Calculations.formatCurrency(Calculations.MAX_AMOUNT) + '.'
      );
      isValid = false;
      firstInvalidEl = firstInvalidEl || amountInput;
    } else {
      Validation.setFieldError(amountInput, amountErrorEl, '');
    }

    var grantNumberValue = grantNumberInput.value.trim();
    if (grantNumberValue && !isValidGrantNumber(grantNumberValue)) {
      grantNumberInput.setAttribute('aria-invalid', 'true');
      grantNumberErrorEl.textContent = 'Grant number must be a number between 10000 and 99999.';
      isValid = false;
      firstInvalidEl = firstInvalidEl || grantNumberInput;
    } else {
      grantNumberInput.removeAttribute('aria-invalid');
      grantNumberErrorEl.textContent = '';
    }

    return { isValid: isValid, firstInvalidEl: firstInvalidEl };
  }

  // -----------------------------------------------------------
  // Collecting form data
  // -----------------------------------------------------------

  function collectFormData() {
    var grantSource = getCheckedRadioValue(grantSourceRadios);
    var activityCode = selectedActivity ? selectedActivity.code : '';
    var category = getCheckedRadioValue(categoryRadios);
    var grantNumber = grantNumberInput.value.trim();
    var activityEntry = selectedActivity;

    return {
      requestType: 'grant',
      preparedBy: document.getElementById('preparedBy').value.trim(),
      title: document.getElementById('title').value.trim(),
      requestorEmail: requestorEmailInput.value.trim(),
      grantSource: grantSource,
      activityCode: activityCode,
      activityLabel: activityEntry ? activityEntry.label : '',
      grantingAgency: grantingAgencyInput.value.trim(),
      grantProgramName: grantProgramNameInput.value.trim(),
      boardApprovalDate: boardApprovalDateInput.value,
      department: selectedDepartment,
      category: category,
      amount: amountInput.value,
      grantNumber: grantNumber,
      revenueAccountNumber: buildRevenueAccountNumber(selectedDepartment, grantSource, activityCode, grantNumber),
      expenseAccountNumber: buildExpenseAccountNumber(selectedDepartment, category, grantNumber),
    };
  }

  // -----------------------------------------------------------
  // Print view — mirrors app.js's/rollforward.js's populatePrintView().
  // -----------------------------------------------------------

  function formatPrintDate(isoDate) {
    if (!isoDate) return '—';
    var parts = isoDate.split('-');
    return parts.length === 3 ? (parts[1] + '/' + parts[2] + '/' + parts[0]) : isoDate;
  }

  function populatePrintTable(body, accountNumber) {
    body.innerHTML = '';
    if (!accountNumber) return;

    var tr = document.createElement('tr');
    var numberCell = document.createElement('td');
    numberCell.textContent = accountNumber;
    tr.appendChild(numberCell);

    var amountCell = document.createElement('td');
    var amount = Calculations.isValidAmount(amountInput.value) ? Calculations.parseAmount(amountInput.value) : 0;
    amountCell.textContent = Calculations.formatCurrency(amount);
    tr.appendChild(amountCell);

    body.appendChild(tr);
  }

  function populatePrintView() {
    var grantSource = getCheckedRadioValue(grantSourceRadios);
    var activityCode = selectedActivity ? selectedActivity.code : '';
    var category = getCheckedRadioValue(categoryRadios);
    var grantNumber = grantNumberInput.value.trim();
    var typeCode = GRANT_TYPE_CODES[grantSource];
    var activityEntry = selectedActivity;

    printEls.preparedBy.textContent = document.getElementById('preparedBy').value.trim() || '—';
    printEls.title.textContent = document.getElementById('title').value.trim() || '—';
    printEls.requestorEmail.textContent = requestorEmailInput.value.trim() || '—';
    printEls.grantSource.textContent = grantSource ? GRANT_SOURCE_LABELS[grantSource] : '—';
    printEls.activity.textContent = activityEntry ? (typeCode + '.' + activityEntry.code + ' — ' + activityEntry.label) : '—';
    printEls.department.textContent = selectedDepartment ? (selectedDepartment.code + ' - ' + selectedDepartment.name) : '—';
    printEls.grantNumber.textContent = grantNumber || '—';
    printEls.grantingAgency.textContent = grantingAgencyInput.value.trim() || '—';
    printEls.grantProgramName.textContent = grantProgramNameInput.value.trim() || '—';
    printEls.boardApprovalDate.textContent = formatPrintDate(boardApprovalDateInput.value);

    populatePrintTable(printEls.revenueBody, buildRevenueAccountNumber(selectedDepartment, grantSource, activityCode, grantNumber));
    populatePrintTable(printEls.expenseBody, buildExpenseAccountNumber(selectedDepartment, category, grantNumber));
  }

  // -----------------------------------------------------------
  // Grant Resolution — a dynamic version of the county's standard
  // resolution template (see grant.html's #resolutionPrintView). The
  // letterhead/signature blocks are fixed boilerplate already in the
  // HTML; only the resolution number, title paragraph, WHEREAS/RESOLVED
  // clauses, and adoption date are filled in here.
  // -----------------------------------------------------------

  // "11th", "2nd", "3rd", "4th", ... — 11-13 are the exception to the
  // usual last-digit rule (11th/12th/13th, not 11st/12nd/13rd).
  function ordinal(day) {
    var n = Number(day);
    if (n % 100 >= 11 && n % 100 <= 13) return n + 'th';
    switch (n % 10) {
      case 1: return n + 'st';
      case 2: return n + 'nd';
      case 3: return n + 'rd';
      default: return n + 'th';
    }
  }

  var MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  function populateResolutionView() {
    var fundName = getFundName(selectedDepartment ? selectedDepartment.code : '');
    var amount = Calculations.isValidAmount(amountInput.value) ? Calculations.parseAmount(amountInput.value) : 0;
    var amountFormatted = Calculations.formatCurrency(amount);
    var grantingAgency = grantingAgencyInput.value.trim();
    var grantProgramName = grantProgramNameInput.value.trim();

    // boardApprovalDate is a plain "YYYY-MM-DD" <input type="date"> value —
    // split/rearrange directly rather than going through `new Date(...)`,
    // which parses that format as UTC midnight and can land on the wrong
    // calendar day in negative-UTC-offset timezones (same reasoning as
    // formatPrintDate() above).
    var dateParts = (boardApprovalDateInput.value || '').split('-');
    var year = dateParts[0] || '';
    var monthName = dateParts[1] ? MONTH_NAMES[Number(dateParts[1]) - 1] : '';
    var dayOrdinal = dateParts[2] ? ordinal(Number(dateParts[2])) : '';

    resolutionEls.number.textContent = 'RESOLUTION ' + year + ' - ________';

    resolutionEls.title.textContent = 'A RESOLUTION OF THE BOARD OF COUNTY COMMISSIONERS OF WALTON COUNTY, '
      + 'FLORIDA, AMENDING THE BUDGET IN THE ' + fundName.toUpperCase() + ' IN THE AMOUNT OF '
      + amountFormatted + ' FOR FISCAL YEAR ' + year + ' FOR UNANTICIPATED GRANT REVENUE FROM THE '
      + grantingAgency.toUpperCase() + ' THROUGH THE ' + grantProgramName.toUpperCase() + '.';

    resolutionEls.whereas.textContent = 'WHEREAS, Walton County when preparing the budget for fiscal year '
      + year + ' did not anticipate receiving a ' + grantProgramName;

    resolutionEls.resolved.textContent = 'NOW, THEREFORE, BE IT RESOLVED by the Board of County Commissioners of '
      + 'Walton County, Florida, that the ' + fundName + ' revenue and expense line items be adjusted in the '
      + 'amount of ' + amountFormatted + ' to account for these funds.';

    resolutionEls.adopted.textContent = 'ADOPTED on this ' + dayOrdinal + ' day of ' + monthName + ', ' + year;
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
    submissionModalBody.textContent = 'Your Grant Amendment Request has been submitted to the '
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

    hideStatus();
    setSubmitting(true);

    var requestData = collectFormData();

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
    resolutionPrintView.style.display = 'none';
    printView.style.removeProperty('display');
    Print.printForm();
  });

  generateResolutionBtn.addEventListener('click', function () {
    var result = validateForm();

    if (!result.isValid) {
      showStatus('banner-error', 'Please correct the highlighted fields before generating the resolution.');
      if (result.firstInvalidEl) {
        result.firstInvalidEl.focus();
        result.firstInvalidEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    hideStatus();
    populateResolutionView();
    printView.style.display = 'none';
    resolutionPrintView.style.removeProperty('display');
    Print.printForm();
  });

  clearBtn.addEventListener('click', function () {
    var confirmed = window.confirm('Clear the form? Any unsaved changes will be lost.');
    if (!confirmed) return;

    form.reset();
    agreementErrorEl.textContent = '';
    agreementRadios.forEach(function (r) { r.closest('.radio-option').classList.remove('is-checked'); });
    Validation.setFieldError(boardApprovalDateInput, boardApprovalDateErrorEl, '');
    evaluateGate();
    requiredFields.forEach(function (field) { Validation.setFieldError(field.input, field.error, ''); });
    Validation.setFieldError(requestorEmailInput, requestorEmailErrorEl, '');
    grantSourceErrorEl.textContent = '';
    grantSourceRadios.forEach(function (r) { r.closest('.radio-option').classList.remove('is-checked'); });
    resetActivitySelection('');
    activityCodeErrorEl.textContent = '';
    categoryErrorEl.textContent = '';
    categoryRadios.forEach(function (r) { r.closest('.radio-option').classList.remove('is-checked'); });
    Validation.setFieldError(grantNumberInput, grantNumberErrorEl, '');
    departmentController.clearSelection(false);
    selectedDepartment = null;
    departmentErrorEl.textContent = '';
    updateAccountPreviews();
    setSubmitting(false);
    hideStatus();
  });

  // -----------------------------------------------------------
  // Init
  // -----------------------------------------------------------

  evaluateGate();
  resetActivitySelection('');
  updateAccountPreviews();
  loadChartOfAccounts();

  window.BudgetApp.refreshChartOfAccounts = handleRefreshCoa;
})(
  window.BudgetApp.Calculations,
  window.BudgetApp.GoogleSheets,
  window.BudgetApp.Departments,
  window.BudgetApp.AccountSearch,
  window.BudgetApp.Validation,
  window.BudgetApp.Print,
  window.BudgetApp.Submission
);
