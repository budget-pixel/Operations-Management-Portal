/* =============================================================
   capitalProjectsList.js
   Drives capital-projects.html: loads the Capital Improvement Plan
   ledger, renders it as a table with Fund/Phase/Dept filters, and
   lets anyone update a project's Project Phase inline (saves on
   change) and Status Notes (saves on blur) — same "no roles yet"
   v1 scope as Work Orders' list page. Every other column (budget
   figures, narrative, funding source, etc.) is read-only here.

   Depends on: window.BudgetApp.CapitalProjects, window.BudgetApp.Calculations
   ============================================================= */

(function (CapitalProjects, Calculations) {
  'use strict';

  var PHASE_OPTIONS = [
    'Identification', 'Design', 'Bidding', 'Construction', 'On Hold', 'Complete', 'Cancelled', 'None',
  ];

  var apiStatusBanner = document.getElementById('apiStatusBanner');
  var fundFilter = document.getElementById('fundFilter');
  var phaseFilter = document.getElementById('phaseFilter');
  var deptFilter = document.getElementById('deptFilter');
  var tbody = document.getElementById('capitalProjectsBody');

  var allProjects = [];

  function showApiError(message) {
    apiStatusBanner.className = 'banner banner-error no-print';
    apiStatusBanner.textContent = message;
    apiStatusBanner.hidden = false;
  }

  function hideApiError() {
    apiStatusBanner.hidden = true;
  }

  function cell(text) {
    var td = document.createElement('td');
    td.textContent = text;
    return td;
  }

  function currencyCell(amount) {
    var td = document.createElement('td');
    td.textContent = Calculations.formatCurrency(amount || 0);
    return td;
  }

  function formatDate(value) {
    if (!value) return '';
    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString();
  }

  function buildPhaseCell(project) {
    var td = document.createElement('td');
    var select = document.createElement('select');

    PHASE_OPTIONS.forEach(function (phase) {
      var option = document.createElement('option');
      option.value = phase;
      option.textContent = phase;
      option.selected = phase === project.phase;
      select.appendChild(option);
    });
    // The sheet may already contain a phase value outside the standard
    // list (typo, blank, or one set before this page existed) — keep it
    // selectable rather than silently swapping it for the first option.
    if (project.phase && PHASE_OPTIONS.indexOf(project.phase) === -1) {
      var customOption = document.createElement('option');
      customOption.value = project.phase;
      customOption.textContent = project.phase;
      customOption.selected = true;
      select.insertBefore(customOption, select.firstChild);
    }

    var savedNote = document.createElement('span');
    savedNote.className = 'field-hint';
    savedNote.style.display = 'block';

    select.addEventListener('change', function () {
      savedNote.textContent = 'Saving...';
      CapitalProjects.submitUpdate({
        projectName: project.projectName,
        phase: select.value,
        statusNotes: project.statusNotes,
      })
        .then(function () {
          project.phase = select.value;
          savedNote.textContent = 'Saved.';
        })
        .catch(function (err) {
          savedNote.textContent = err.message;
          select.value = project.phase;
        });
    });

    td.appendChild(select);
    td.appendChild(savedNote);
    return td;
  }

  function buildStatusNotesCell(project) {
    var td = document.createElement('td');
    var textarea = document.createElement('textarea');
    textarea.value = project.statusNotes || '';
    textarea.rows = 2;
    textarea.style.minWidth = '10rem';

    var savedNote = document.createElement('span');
    savedNote.className = 'field-hint';
    savedNote.style.display = 'block';

    textarea.addEventListener('blur', function () {
      if (textarea.value === project.statusNotes) return;
      savedNote.textContent = 'Saving...';
      CapitalProjects.submitUpdate({
        projectName: project.projectName,
        phase: project.phase,
        statusNotes: textarea.value,
      })
        .then(function () {
          project.statusNotes = textarea.value;
          savedNote.textContent = 'Saved.';
        })
        .catch(function (err) {
          savedNote.textContent = err.message;
          textarea.value = project.statusNotes;
        });
    });

    td.appendChild(textarea);
    td.appendChild(savedNote);
    return td;
  }

  function renderRows(projects) {
    tbody.innerHTML = '';

    if (projects.length === 0) {
      var emptyRow = document.createElement('tr');
      var emptyCell = document.createElement('td');
      emptyCell.colSpan = 13;
      emptyCell.textContent = 'No capital projects found.';
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
      return;
    }

    projects.forEach(function (project) {
      var row = document.createElement('tr');
      row.appendChild(cell(project.projectName));
      row.appendChild(cell(project.dept));
      row.appendChild(cell(project.fund));
      row.appendChild(cell(project.priority));
      row.appendChild(currencyCell(project.fy2027));
      row.appendChild(currencyCell(project.fy2028));
      row.appendChild(currencyCell(project.fy2029));
      row.appendChild(currencyCell(project.fy2030));
      row.appendChild(currencyCell(project.fy2031));
      row.appendChild(currencyCell(project.totalFy2027to2031));
      row.appendChild(buildPhaseCell(project));
      row.appendChild(buildStatusNotesCell(project));
      row.appendChild(cell(formatDate(project.lastUpdated)));
      tbody.appendChild(row);
    });
  }

  function matchesFilters(project) {
    if (fundFilter.value !== 'All' && project.fund !== fundFilter.value) return false;
    if (phaseFilter.value !== 'All' && project.phase !== phaseFilter.value) return false;
    if (deptFilter.value !== 'All' && project.dept !== deptFilter.value) return false;
    return true;
  }

  function applyFilters() {
    renderRows(allProjects.filter(matchesFilters));
  }

  function uniqueSorted(values) {
    var seen = {};
    var result = [];
    values.forEach(function (value) {
      if (!value || seen[value]) return;
      seen[value] = true;
      result.push(value);
    });
    result.sort();
    return result;
  }

  function populateFilter(select, options) {
    options.forEach(function (option) {
      var optionEl = document.createElement('option');
      optionEl.value = option;
      optionEl.textContent = option;
      select.appendChild(optionEl);
    });
  }

  function loadProjects() {
    tbody.innerHTML = '<tr><td colspan="13">Loading capital projects...</td></tr>';
    CapitalProjects.getProjects()
      .then(function (projects) {
        hideApiError();
        allProjects = projects;
        populateFilter(fundFilter, uniqueSorted(projects.map(function (p) { return p.fund; })));
        populateFilter(phaseFilter, uniqueSorted(projects.map(function (p) { return p.phase; })));
        populateFilter(deptFilter, uniqueSorted(projects.map(function (p) { return p.dept; })));
        if (projects.length === 0) {
          showApiError(
            'No capital projects found. Check that the "Capital Improvement Plan" tab exists in the '
            + 'connected spreadsheet with data rows — see docs/google-sheets-integration.md §10.'
          );
        }
        applyFilters();
      })
      .catch(function (err) {
        tbody.innerHTML = '';
        showApiError(err.message);
      });
  }

  function init() {
    loadProjects();
    [fundFilter, phaseFilter, deptFilter].forEach(function (select) {
      select.addEventListener('change', applyFilters);
    });
  }

  init();
})(window.BudgetApp.CapitalProjects, window.BudgetApp.Calculations);
