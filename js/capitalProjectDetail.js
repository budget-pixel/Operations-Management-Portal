/* =============================================================
   capitalProjectDetail.js
   Drives capital-project.html: loads one Capital Improvement Plan
   project (found via the ?name= query param against the same
   cached project list capital-projects.html uses) and renders it
   as a detail page modeled on the county's public CIP project page
   layout. All editing lives here — Phase, Status, Dept, Priority,
   Project Narrative, Operational Impact, Pertinent Information,
   Strategic Goals, the ten FY2022-FY2031 Proposed amounts, project
   details (code/manager/district/location/funding source/dates/
   in-house engineering), and Status Notes — since capital-projects.html
   is now just a browsable list with links into this page. FY2022-2026
   cover the historical project record, FY2027-2031 the live proposed
   CIP — both live in the same sheet row, editable the same way.

   Also renders a "Public Preview" — a read-only view (renderPublicPreview)
   built from the exact same project data, laid out the way budgetv2's
   public CIP project pages present a project, so staff can see what the
   public will see before/after making a change without leaving this
   page. Toggled via #cipViewToggle; never contains an editable control.

   Depends on: window.BudgetApp.CapitalProjects, window.BudgetApp.Calculations
   ============================================================= */

(function (CapitalProjects, Calculations) {
  'use strict';

  var PHASE_OPTIONS = [
    'Identification', 'Design', 'Bidding', 'Construction', 'On Hold', 'Complete', 'Cancelled', 'None',
  ];
  var PRIORITY_OPTIONS = [
    'Critical – Safety & Compliance', 'High – Strategic Growth', 'Medium', 'Low', 'None',
  ];
  var DISTRICT_OPTIONS = [
    'District 1', 'District 2', 'District 3', 'District 4', 'District 5', 'Countywide', 'Not specified',
  ];
  var STATUS_OPTIONS = ['Programmed', 'In Progress', 'Complete', 'Cancelled', 'None'];
  var FUND_OPTIONS = [
    'Capital Projects Fund', 'Transportation Fund', 'Tourist Development Fund', 'Grant Funded', 'Sheriff Fund',
  ];
  var HISTORICAL_FY_FIELDS = ['fy2022', 'fy2023', 'fy2024', 'fy2025', 'fy2026'];
  var PROPOSED_FY_FIELDS = ['fy2027', 'fy2028', 'fy2029', 'fy2030', 'fy2031'];
  var FY_LABELS = {
    fy2022: 'FY2022', fy2023: 'FY2023', fy2024: 'FY2024', fy2025: 'FY2025', fy2026: 'FY2026',
    fy2027: 'FY2027', fy2028: 'FY2028', fy2029: 'FY2029', fy2030: 'FY2030', fy2031: 'FY2031',
  };

  var apiStatusBanner = document.getElementById('apiStatusBanner');
  var content = document.getElementById('cipDetailContent');
  var publicPreview = document.getElementById('cipPublicPreview');
  var viewToggle = document.getElementById('cipViewToggle');

  function showApiError(message) {
    apiStatusBanner.className = 'banner banner-error no-print';
    apiStatusBanner.textContent = message;
    apiStatusBanner.hidden = false;
  }

  function getProjectNameFromQuery() {
    var params = new URLSearchParams(window.location.search);
    return params.get('name') || '';
  }

  function isNewProjectMode() {
    return new URLSearchParams(window.location.search).get('new') === '1';
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function renderNotFound(projectName) {
    var wrap = el('div', 'cip-detail-not-found');
    wrap.appendChild(el('h1', null, 'Project not found'));
    wrap.appendChild(el('p', null, projectName
      ? 'No capital project named "' + projectName + '" was found.'
      : 'No project was specified.'));
    var link = document.createElement('a');
    link.href = 'capital-projects.html';
    link.className = 'btn btn-primary';
    link.textContent = 'Back to Capital Projects';
    wrap.appendChild(link);
    content.appendChild(wrap);
  }

  function kickerItem(label, value) {
    var item = el('div', 'cip-detail-kicker-item');
    item.appendChild(el('span', null, label));
    item.appendChild(el('strong', null, value || '—'));
    return item;
  }

  function buildSavedNote() {
    var note = el('span', 'field-hint');
    note.style.display = 'block';
    note.style.marginTop = '6px';
    return note;
  }

  // Saves ONLY the field(s) in `overrides` — a deliberate partial update,
  // not a full-snapshot resend of every editable field. The backend
  // (handleCapitalProjectUpdate) only writes columns whose key is present
  // in the request. Sending the full snapshot every time was tried first
  // and caused silent data loss: if two edits landed close together (a
  // race between two in-flight saves) or the page's copy of the project
  // was stale (e.g. edited from a second tab), the "unchanged" fields
  // included in that snapshot would overwrite newer values already on the
  // sheet with stale ones. Only ever sending what actually changed makes
  // that impossible.
  function saveProject(project, overrides, savedNote, onError) {
    var payload = Object.assign({ projectName: project.projectName }, overrides);

    savedNote.textContent = 'Saving...';
    CapitalProjects.submitUpdate(payload)
      .then(function () {
        Object.keys(overrides).forEach(function (key) {
          project[key] = overrides[key];
        });
        savedNote.textContent = 'Saved.';
        // Invalidates the cached project list (see js/capitalProjects.js)
        // so navigating back to capital-projects.html, or opening another
        // project, doesn't show this project's pre-edit values from a now
        // out-of-date session cache. Fire-and-forget — this page already
        // has what it needs in `project`.
        CapitalProjects.refresh().catch(function () {});
      })
      .catch(function (err) {
        savedNote.textContent = err.message;
        onError();
      });
  }

  function buildSelectField(project, field, label, options) {
    var wrap = el('div', 'cip-detail-field');
    wrap.appendChild(el('label', null, label));
    var select = document.createElement('select');
    var currentValue = project[field];

    // A genuinely blank value must not silently render as the first real
    // option looking selected (a <select> with nothing marked `selected`
    // just shows its first option) — that misled the Fund kicker/badge
    // display, which reads project.fund directly and correctly showed
    // blank, while the dropdown right next to it appeared to have
    // "Capital Projects Fund" picked. An explicit placeholder makes the
    // unset state honest in the control itself.
    if (!currentValue) {
      var placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '— None —';
      placeholder.selected = true;
      select.appendChild(placeholder);
    }

    options.forEach(function (option) {
      var optionEl = document.createElement('option');
      optionEl.value = option;
      optionEl.textContent = option;
      optionEl.selected = option === currentValue;
      select.appendChild(optionEl);
    });
    if (currentValue && options.indexOf(currentValue) === -1) {
      var customOption = document.createElement('option');
      customOption.value = currentValue;
      customOption.textContent = currentValue;
      customOption.selected = true;
      select.insertBefore(customOption, select.firstChild);
    }

    var savedNote = buildSavedNote();
    select.addEventListener('change', function () {
      var overrides = {};
      overrides[field] = select.value;
      saveProject(project, overrides, savedNote, function () { select.value = project[field]; });
    });

    wrap.appendChild(select);
    wrap.appendChild(savedNote);
    return wrap;
  }

  function buildTextField(project, field, label) {
    var wrap = el('div', 'cip-detail-field');
    wrap.appendChild(el('label', null, label));
    var input = document.createElement('input');
    input.type = 'text';
    input.value = project[field] || '';

    var savedNote = buildSavedNote();
    input.addEventListener('blur', function () {
      if (input.value === project[field]) return;
      var overrides = {};
      overrides[field] = input.value;
      saveProject(project, overrides, savedNote, function () { input.value = project[field]; });
    });

    wrap.appendChild(input);
    wrap.appendChild(savedNote);
    return wrap;
  }

  var MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  // Normalizes a date-ish value to "January 2026" for display and for
  // what gets saved back — handles the formats already found in the
  // sheet (MM/YYYY, YYYY-MM, a bare year, a full date) by falling back to
  // the browser's native Date parser. Anything that isn't parseable as a
  // date at all (e.g. "TBD", blank) is left exactly as typed, since Start
  // Date/Estimated Completion Date are still free text on the sheet, not
  // a strict date column.
  function formatMonthYear(value) {
    var trimmed = String(value || '').trim();
    if (!trimmed) return '';

    var mmYyyy = /^(\d{1,2})\/(\d{4})$/.exec(trimmed);
    if (mmYyyy) {
      var mmIndex = parseInt(mmYyyy[1], 10) - 1;
      if (mmIndex >= 0 && mmIndex <= 11) return MONTH_NAMES[mmIndex] + ' ' + mmYyyy[2];
    }

    var yyyyMm = /^(\d{4})-(\d{1,2})$/.exec(trimmed);
    if (yyyyMm) {
      var yIndex = parseInt(yyyyMm[2], 10) - 1;
      if (yIndex >= 0 && yIndex <= 11) return MONTH_NAMES[yIndex] + ' ' + yyyyMm[1];
    }

    if (/\d/.test(trimmed)) {
      var date = new Date(trimmed);
      if (!isNaN(date.getTime())) {
        return MONTH_NAMES[date.getUTCMonth()] + ' ' + date.getUTCFullYear();
      }
    }

    return trimmed;
  }

  function buildMonthYearField(project, field, label) {
    var wrap = el('div', 'cip-detail-field');
    wrap.appendChild(el('label', null, label));
    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'e.g. January 2026';
    input.value = formatMonthYear(project[field]);

    var savedNote = buildSavedNote();
    input.addEventListener('blur', function () {
      var formatted = formatMonthYear(input.value);
      if (formatted === project[field]) {
        input.value = formatted;
        return;
      }
      var overrides = {};
      overrides[field] = formatted;
      saveProject(project, overrides, savedNote, function () { input.value = formatMonthYear(project[field]); });
      input.value = formatted;
    });

    wrap.appendChild(input);
    wrap.appendChild(savedNote);
    return wrap;
  }

  function buildTextareaField(project, field, label, rows) {
    var wrap = el('div', 'cip-detail-field');
    wrap.appendChild(el('label', null, label));
    var textarea = document.createElement('textarea');
    textarea.rows = rows || 4;
    textarea.value = project[field] || '';

    var savedNote = buildSavedNote();
    textarea.addEventListener('blur', function () {
      if (textarea.value === project[field]) return;
      var overrides = {};
      overrides[field] = textarea.value;
      saveProject(project, overrides, savedNote, function () { textarea.value = project[field]; });
    });

    wrap.appendChild(textarea);
    wrap.appendChild(savedNote);
    return wrap;
  }

  // Whole-dollar amounts with thousands separators (3000000 -> "3,000,000"),
  // no currency symbol — this is an editable field, not a display total.
  var amountFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  function formatAmountWithCommas(value) {
    return amountFormatter.format(value || 0);
  }

  function buildYearRow(project, field, label) {
    var row = el('div', 'cip-detail-year-row');
    row.appendChild(el('span', null, label || FY_LABELS[field]));

    var input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.value = formatAmountWithCommas(project[field]);

    var savedNote = buildSavedNote();
    savedNote.style.margin = '0';

    // Commas make a formatted value awkward to edit in place, so switch to
    // the plain number on focus and reformat with commas on blur.
    input.addEventListener('focus', function () {
      input.value = project[field] || 0;
    });

    input.addEventListener('blur', function () {
      var numeric = Calculations.parseAmount(input.value);
      if (numeric === project[field]) {
        input.value = formatAmountWithCommas(project[field]);
        return;
      }
      if (!(numeric >= 0)) {
        savedNote.textContent = 'Enter a non-negative amount.';
        input.value = formatAmountWithCommas(project[field]);
        return;
      }
      var overrides = {};
      overrides[field] = numeric;
      saveProject(project, overrides, savedNote, function () {
        input.value = formatAmountWithCommas(project[field]);
      });
      input.value = formatAmountWithCommas(numeric);
    });

    var inputWrap = el('div');
    inputWrap.style.textAlign = 'right';
    inputWrap.appendChild(input);
    inputWrap.appendChild(savedNote);
    row.appendChild(inputWrap);
    return row;
  }

  function formatDate(value) {
    if (!value) return '';
    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  }

  // Public CIP pages separate "phase" (delivery lifecycle stage) from a
  // small fixed set of badge colors — mirrors budgetv2's getStatusClass().
  function phaseBadgeClass(phase) {
    var normalized = String(phase || '').toLowerCase();
    if (normalized.indexOf('construction') !== -1) return 'cip-public-status-construction';
    if (normalized.indexOf('complete') !== -1 || normalized.indexOf('cancel') !== -1) return 'cip-public-status-complete';
    if (normalized.indexOf('design') !== -1 || normalized.indexOf('bid') !== -1
      || normalized.indexOf('permit') !== -1 || normalized.indexOf('engineer') !== -1
      || normalized.indexOf('study') !== -1 || normalized.indexOf('report') !== -1) {
      return 'cip-public-status-design';
    }
    return 'cip-public-status-planning'; // Identification, None, anything unrecognized
  }

  // "Complete" reads the same whether it came from Phase or Status —
  // historical entries mostly set Status, live proposed projects mostly
  // set Phase, and either one means the stated amount is what was
  // actually spent, not a proposal.
  function isProjectComplete(project) {
    return project.status === 'Complete' || project.phase === 'Complete';
  }

  // The single historical (FY2022-2026) field the "Current Budget"/
  // "Actual Cost" row edits — the most recent year that already has a
  // nonzero amount, or FY2026 if none do yet. Almost every historical
  // project only ever has one non-zero year among the five, so this
  // keeps a single editable line meaningful without needing five
  // separate inputs back.
  function primaryHistoricalField(project) {
    for (var i = HISTORICAL_FY_FIELDS.length - 1; i >= 0; i--) {
      if (project[HISTORICAL_FY_FIELDS[i]] > 0) return HISTORICAL_FY_FIELDS[i];
    }
    return 'fy2026';
  }

  function allFyTotal(project) {
    return HISTORICAL_FY_FIELDS.concat(PROPOSED_FY_FIELDS)
      .reduce(function (sum, field) { return sum + (project[field] || 0); }, 0);
  }

  // Renders a read-only preview matching the layout the public CIP site
  // (budgetv2) uses for an individual project page, built from the exact
  // same project data as the editable view above — so staff can see what
  // the public will see before/after making a change, without leaving
  // this page. Never contains an <input>/<select>; nothing here saves.
  function renderPublicPreview(project) {
    publicPreview.innerHTML = '';

    var hero = el('div', 'cip-detail-hero');
    hero.appendChild(el('h1', 'cip-detail-title', project.projectName));
    publicPreview.appendChild(hero);

    var grid = el('div', 'cip-detail-grid');

    var leftStack = el('div', 'cip-detail-stack');

    var overviewPanel = el('div', 'cip-detail-panel');
    overviewPanel.appendChild(el('h2', null, 'Project Overview'));
    overviewPanel.appendChild(el('p', null, project.projectNarrative || 'No project narrative is currently available.'));
    leftStack.appendChild(overviewPanel);

    var budgetPanel = el('div', 'cip-detail-panel');
    budgetPanel.appendChild(el('h2', null, 'Budget & Funding Summary'));
    var highlight = el('div', 'cip-detail-budget-highlight');
    highlight.appendChild(el('span', null, isProjectComplete(project) ? 'Actual Cost' : 'Project Budget'));
    highlight.appendChild(el('strong', null, Calculations.formatCurrency(allFyTotal(project))));
    budgetPanel.appendChild(highlight);
    var fundingItem = el('div', 'cip-detail-list-item');
    fundingItem.appendChild(el('span', null, 'Funding Source'));
    fundingItem.appendChild(el('strong', null, project.fund || '—'));
    budgetPanel.appendChild(fundingItem);

    var fundedYears = HISTORICAL_FY_FIELDS.concat(PROPOSED_FY_FIELDS).filter(function (field) {
      return project[field] > 0;
    });
    if (fundedYears.length > 0) {
      budgetPanel.appendChild(el('h2', null, 'Fiscal Year Breakdown'));
      fundedYears.forEach(function (field) {
        var row = el('div', 'cip-detail-year-row');
        row.appendChild(el('span', null, FY_LABELS[field]));
        row.appendChild(el('strong', null, Calculations.formatCurrency(project[field])));
        row.style.marginBottom = '8px';
        budgetPanel.appendChild(row);
      });
    }
    leftStack.appendChild(budgetPanel);

    grid.appendChild(leftStack);

    var rightStack = el('div', 'cip-detail-stack');

    var detailsPanel = el('div', 'cip-detail-panel');
    detailsPanel.appendChild(el('h2', null, 'Project Details'));
    var detailsList = el('div', 'cip-detail-list');
    detailsList.appendChild((function () {
      var item = el('div', 'cip-detail-list-item');
      item.appendChild(el('span', null, 'Department'));
      item.appendChild(el('strong', null, project.dept || '—'));
      return item;
    })());
    detailsList.appendChild((function () {
      var item = el('div', 'cip-detail-list-item');
      item.appendChild(el('span', null, 'District'));
      item.appendChild(el('strong', null, project.commissionerDistrict || '—'));
      return item;
    })());
    detailsPanel.appendChild(detailsList);
    rightStack.appendChild(detailsPanel);

    var statusPanel = el('div', 'cip-detail-panel');
    var statusHeading = el('div');
    statusHeading.style.display = 'flex';
    statusHeading.style.alignItems = 'center';
    statusHeading.style.justifyContent = 'space-between';
    statusHeading.style.marginBottom = '14px';
    statusHeading.appendChild(el('h2', null, 'Status & Timeline'));
    statusHeading.style.setProperty('--h2-margin', '0');
    var badge = el('span', 'cip-public-badge ' + phaseBadgeClass(project.phase), project.phase || 'Not Available');
    statusHeading.appendChild(badge);
    // Overrides the panel's default h2 margin-bottom since the badge sits
    // beside it on the same line rather than below it.
    statusHeading.querySelector('h2').style.margin = '0';
    statusPanel.appendChild(statusHeading);

    var milestones = [];
    if (project.startDate) milestones.push('Start: ' + formatMonthYear(project.startDate));
    if (project.estCompletionDate) milestones.push('Est. Completion: ' + formatMonthYear(project.estCompletionDate));
    statusPanel.appendChild(el('p', null, milestones.length > 0
      ? milestones.join(' · ')
      : 'No dated project milestones are currently listed.'));
    rightStack.appendChild(statusPanel);

    grid.appendChild(rightStack);
    publicPreview.appendChild(grid);
  }

  function setView(view) {
    var isPublic = view === 'public';
    content.hidden = isPublic;
    publicPreview.style.display = isPublic ? 'block' : 'none';
    viewToggle.querySelectorAll('button').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.dataset.view === view);
    });
  }

  function renderProject(project) {
    document.title = project.projectName + ' — Capital Project Detail';

    viewToggle.hidden = false;
    renderPublicPreview(project);
    viewToggle.querySelectorAll('button').forEach(function (btn) {
      btn.onclick = function () { setView(btn.dataset.view); };
    });

    var hero = el('div', 'cip-detail-hero');

    var titleRow = el('div', 'cip-detail-hero-top');
    titleRow.appendChild(el('h1', 'cip-detail-title', project.projectName));
    var statusLabel = project.status || project.phase;
    if (statusLabel) {
      titleRow.appendChild(el('span', 'cip-public-badge ' + phaseBadgeClass(statusLabel), statusLabel));
    }
    hero.appendChild(titleRow);

    var kicker = el('div', 'cip-detail-kicker');
    kicker.appendChild(kickerItem('Fund', project.fund));
    kicker.appendChild(kickerItem('Department', project.dept));
    kicker.appendChild(kickerItem('Priority', project.priority));
    kicker.appendChild(kickerItem('Phase', project.phase));
    hero.appendChild(kicker);
    content.appendChild(hero);

    var grid = el('div', 'cip-detail-grid');

    // Left column — read-only overview + details.
    var leftStack = el('div', 'cip-detail-stack');

    var overviewPanel = el('div', 'cip-detail-panel');
    overviewPanel.appendChild(el('h2', null, 'Project Overview'));
    overviewPanel.appendChild(buildTextareaField(project, 'projectNarrative', 'Project Narrative', 6));
    leftStack.appendChild(overviewPanel);

    var notesPanel = el('div', 'cip-detail-panel');
    notesPanel.appendChild(el('h2', null, 'Additional Information'));
    notesPanel.appendChild(buildTextareaField(project, 'operationalImpact', 'Operational Impact', 3));
    notesPanel.appendChild(buildTextareaField(project, 'pertinentInformation', 'Pertinent Information', 5));
    notesPanel.appendChild(buildTextareaField(project, 'strategicGoals', 'Strategic Goals', 3));
    leftStack.appendChild(notesPanel);

    var detailsPanel = el('div', 'cip-detail-panel');
    detailsPanel.appendChild(el('h2', null, 'Project Details'));
    detailsPanel.appendChild(buildTextField(project, 'projectCode', 'Project Code'));
    detailsPanel.appendChild(buildTextField(project, 'projectManager', 'Project Manager'));
    detailsPanel.appendChild(buildSelectField(project, 'commissionerDistrict', 'Commissioner District', DISTRICT_OPTIONS));
    detailsPanel.appendChild(buildTextField(project, 'locationName', 'Location'));
    detailsPanel.appendChild(buildTextField(project, 'fundingSource', 'Funding Source'));
    detailsPanel.appendChild(buildMonthYearField(project, 'startDate', 'Start Date'));
    detailsPanel.appendChild(buildMonthYearField(project, 'estCompletionDate', 'Estimated Completion Date'));
    detailsPanel.appendChild(buildTextField(project, 'inHouseEngineering', 'In-House Engineering'));
    leftStack.appendChild(detailsPanel);

    grid.appendChild(leftStack);

    // Right column — budget + editable status.
    var rightStack = el('div', 'cip-detail-stack');

    var budgetPanel = el('div', 'cip-detail-panel');
    budgetPanel.appendChild(el('h2', null, 'Budget — FY2027–FY2031 (Proposed)'));
    var highlight = el('div', 'cip-detail-budget-highlight');
    highlight.appendChild(el('span', null, 'Total FY2027–FY2031'));
    highlight.appendChild(el('strong', null, Calculations.formatCurrency(project.totalFy2027to2031 || 0)));
    budgetPanel.appendChild(highlight);
    // Prior-year (FY2022-2026) funding as a single editable summary line
    // rather than its own panel with five separate rows — edits go to
    // whichever historical year already carries the amount (see
    // primaryHistoricalField), which covers the common case of a project
    // only ever having one non-zero historical year. Labeled "Actual
    // Cost" once the project is marked Complete, since a finished
    // project's amount is what was spent, not a proposal.
    budgetPanel.appendChild(buildYearRow(
      project,
      primaryHistoricalField(project),
      isProjectComplete(project) ? 'Actual Cost' : 'Current Budget'
    ));
    PROPOSED_FY_FIELDS.forEach(function (field) {
      budgetPanel.appendChild(buildYearRow(project, field));
    });
    rightStack.appendChild(budgetPanel);

    var statusPanel = el('div', 'cip-detail-panel');
    statusPanel.appendChild(el('h2', null, 'Status'));
    statusPanel.appendChild(buildSelectField(project, 'phase', 'Project Phase', PHASE_OPTIONS));
    statusPanel.appendChild(buildSelectField(project, 'status', 'Status', STATUS_OPTIONS));
    statusPanel.appendChild(buildTextField(project, 'dept', 'Dept'));
    statusPanel.appendChild(buildSelectField(project, 'fund', 'Fund', FUND_OPTIONS));
    statusPanel.appendChild(buildSelectField(project, 'priority', 'Priority', PRIORITY_OPTIONS));
    statusPanel.appendChild(buildTextareaField(project, 'statusNotes', 'Status Notes', 4));
    var lastUpdated = el('p', null, 'Last updated: ' + (formatDate(project.lastUpdated) || 'never')
      + (project.lastUpdatedBy ? ' by ' + project.lastUpdatedBy : ''));
    lastUpdated.style.textAlign = 'left';
    lastUpdated.style.fontSize = '12px';
    lastUpdated.style.marginTop = '12px';
    statusPanel.appendChild(lastUpdated);
    rightStack.appendChild(statusPanel);

    rightStack.appendChild(buildDeletePanel(project));

    grid.appendChild(rightStack);
    content.appendChild(grid);
  }

  function buildDeletePanel(project) {
    var panel = el('div', 'cip-detail-panel');
    panel.appendChild(el('h2', null, 'Delete Project'));
    panel.appendChild(el('p', null,
      'Permanently removes this project from the Capital Improvement Plan. This cannot be undone from the page — only from the spreadsheet’s own Version History.'));

    var deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-danger';
    deleteBtn.textContent = 'Delete Project';
    deleteBtn.style.marginTop = '10px';

    var savedNote = buildSavedNote();

    deleteBtn.addEventListener('click', function () {
      var confirmed = window.confirm(
        'Delete "' + project.projectName + '" permanently? This cannot be undone from this page.'
      );
      if (!confirmed) return;

      deleteBtn.disabled = true;
      savedNote.textContent = 'Deleting...';
      CapitalProjects.deleteProject(project.projectName)
        .then(function () {
          CapitalProjects.refresh().catch(function () {});
          window.location.href = 'capital-projects.html';
        })
        .catch(function (err) {
          deleteBtn.disabled = false;
          savedNote.textContent = err.message;
        });
    });

    panel.appendChild(deleteBtn);
    panel.appendChild(savedNote);
    return panel;
  }

  function renderNewProjectForm() {
    document.title = 'New Capital Project';

    var hero = el('div', 'cip-detail-hero');
    hero.appendChild(el('h1', 'cip-detail-title', 'New Capital Project'));
    hero.appendChild(el('p', 'cip-detail-description',
      'Create a new project on the Capital Improvement Plan. You can fill in the rest of its details — narrative, budget, dates, and more — after it’s created.'));
    content.appendChild(hero);

    var panel = el('div', 'cip-detail-panel');
    panel.style.maxWidth = '520px';

    var nameField = el('div', 'cip-detail-field');
    nameField.appendChild(el('label', null, 'Project Name (required)'));
    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameField.appendChild(nameInput);
    panel.appendChild(nameField);

    var deptField = el('div', 'cip-detail-field');
    deptField.appendChild(el('label', null, 'Dept'));
    var deptInput = document.createElement('input');
    deptInput.type = 'text';
    deptField.appendChild(deptInput);
    panel.appendChild(deptField);

    var fundField = el('div', 'cip-detail-field');
    fundField.appendChild(el('label', null, 'Fund'));
    var fundSelect = document.createElement('select');
    FUND_OPTIONS.forEach(function (option) {
      var optionEl = document.createElement('option');
      optionEl.value = option;
      optionEl.textContent = option;
      fundSelect.appendChild(optionEl);
    });
    fundField.appendChild(fundSelect);
    panel.appendChild(fundField);

    var phaseField = el('div', 'cip-detail-field');
    phaseField.appendChild(el('label', null, 'Project Phase'));
    var phaseSelect = document.createElement('select');
    PHASE_OPTIONS.forEach(function (option) {
      var optionEl = document.createElement('option');
      optionEl.value = option;
      optionEl.textContent = option;
      phaseSelect.appendChild(optionEl);
    });
    phaseField.appendChild(phaseSelect);
    panel.appendChild(phaseField);

    var createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.className = 'btn btn-primary';
    createBtn.textContent = 'Create Project';
    createBtn.style.marginTop = '6px';

    var savedNote = buildSavedNote();

    createBtn.addEventListener('click', function () {
      var projectName = nameInput.value.trim();
      if (!projectName) {
        savedNote.textContent = 'Project name is required.';
        return;
      }
      createBtn.disabled = true;
      savedNote.textContent = 'Creating...';
      CapitalProjects.createProject({
        projectName: projectName,
        dept: deptInput.value.trim(),
        fund: fundSelect.value,
        phase: phaseSelect.value,
      })
        .then(function () {
          CapitalProjects.refresh().catch(function () {});
          window.location.href = 'capital-project.html?name=' + encodeURIComponent(projectName);
        })
        .catch(function (err) {
          createBtn.disabled = false;
          savedNote.textContent = err.message;
        });
    });

    panel.appendChild(createBtn);
    panel.appendChild(savedNote);
    content.appendChild(panel);
  }

  function init() {
    if (isNewProjectMode()) {
      renderNewProjectForm();
      return;
    }

    var projectName = getProjectNameFromQuery();
    CapitalProjects.getProjects()
      .then(function (projects) {
        var project = projects.filter(function (p) { return p.projectName === projectName; })[0];
        if (!project) {
          renderNotFound(projectName);
          return;
        }
        renderProject(project);
      })
      .catch(function (err) {
        showApiError(err.message);
      });
  }

  init();
})(window.BudgetApp.CapitalProjects, window.BudgetApp.Calculations);
