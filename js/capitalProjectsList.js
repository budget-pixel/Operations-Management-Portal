/* =============================================================
   capitalProjectsList.js
   Drives capital-projects.html: loads the Capital Improvement Plan
   ledger — both the live FY2027-2031 projects and the FY2022-2026
   historical record, unified in the same sheet/tab — and renders a
   simple, browsable list — Project Number, Project Name (links to
   capital-project.html for full detail and editing), Fund, Phase,
   Completed / Est. Start, Status, Budget / Actual (sum of all ten FY2022-FY2031 amounts — Dept
   is filterable but not shown as a column) — filterable by a
   project-name search box, Fund/Phase/Dept/Status dropdowns, and a
   funded-year pill row (All/Past CIP/FY2027..FY2031 — "Past CIP"
   groups FY2022-FY2026), styled like the year tabs on budgetv2's
   public CIP pages rather than a dropdown. All other fields and
   every edit control live on the project detail page
   (js/capitalProjectDetail.js), not here.

   Depends on: window.BudgetApp.CapitalProjects, window.BudgetApp.Calculations
   ============================================================= */

(function (CapitalProjects, Calculations) {
  'use strict';

  var apiStatusBanner = document.getElementById('apiStatusBanner');
  var searchInput = document.getElementById('searchInput');
  var fundFilter = document.getElementById('fundFilter');
  var phaseFilter = document.getElementById('phaseFilter');
  var deptFilter = document.getElementById('deptFilter');
  var statusFilter = document.getElementById('statusFilter');
  var yearFilterPills = document.getElementById('yearFilterPills');
  var refreshBtn = document.getElementById('refreshProjectsBtn');
  var tbody = document.getElementById('capitalProjectsBody');

  // Tracks the active year pill's data-year value (All/past/fy2027..fy2031)
  // — the pill row replaces what used to be a <select id="yearFilter">.
  var selectedYear = 'All';

  // FY2022-FY2026 — the fiscal years the "Past CIP" grouped year-filter
  // option matches against (any one of them funded is a match).
  var PAST_CIP_FY_FIELDS = ['fy2022', 'fy2023', 'fy2024', 'fy2025', 'fy2026'];
  var FUTURE_CIP_FY_FIELDS = ['fy2027', 'fy2028', 'fy2029', 'fy2030', 'fy2031'];

  // All ten fiscal years — summed for the Budget / Actual column, since a
  // project only ever has amounts in one era (historical FY2022-2026 OR
  // live proposed FY2027-2031), not both.
  var ALL_FY_FIELDS = PAST_CIP_FY_FIELDS.concat(FUTURE_CIP_FY_FIELDS);
  var MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  function totalBudget(project) {
    return ALL_FY_FIELDS.reduce(function (sum, field) { return sum + (project[field] || 0); }, 0);
  }

  function formatMonthYear(value) {
    var trimmed = String(value || '').trim();
    if (!trimmed) return '';

    var mmYyyy = /^(\d{1,2})\/(\d{4})$/.exec(trimmed);
    if (mmYyyy) {
      var monthIndex = parseInt(mmYyyy[1], 10) - 1;
      if (monthIndex >= 0 && monthIndex <= 11) return MONTH_NAMES[monthIndex] + ' ' + mmYyyy[2];
    }

    var yyyyMm = /^(\d{4})-(\d{1,2})$/.exec(trimmed);
    if (yyyyMm) {
      var yearMonthIndex = parseInt(yyyyMm[2], 10) - 1;
      if (yearMonthIndex >= 0 && yearMonthIndex <= 11) {
        return MONTH_NAMES[yearMonthIndex] + ' ' + yyyyMm[1];
      }
    }

    if (/\d/.test(trimmed)) {
      var date = new Date(trimmed);
      if (!isNaN(date.getTime())) {
        return MONTH_NAMES[date.getUTCMonth()] + ' ' + date.getUTCFullYear();
      }
    }

    return trimmed;
  }

  function isGrantFundedProject(project) {
    return /grant funded/i.test(project.fund || '')
      || /^grant\b/i.test(project.projectName || '')
      || /grant funded/i.test(project.statusNotes || '');
  }

  function isCompletedProject(project) {
    return /^(complete|completed)$/i.test(String(project.status || '').trim());
  }

  function hasStatus(project, status) {
    return String(project.status || '').trim().toLowerCase() === status;
  }

  function isActiveGrantFundedProject(project) {
    return isGrantFundedProject(project) && !isCompletedProject(project);
  }

  // Fixed, not derived from the loaded data — matches the dropdown
  // capital-project.html's detail page offers (see STATUS_OPTIONS in
  // js/capitalProjectDetail.js). Deriving this from project.status values
  // actually present would leave the filter with nothing but "All" until
  // someone has manually set a Status on at least one project, since the
  // sheet's Status column starts out blank for every live FY2027-2031
  // project (only the historical import fills it in, and only for rows
  // it adds).
  var STATUS_OPTIONS = ['Programmed', 'In Progress', 'Complete', 'Cancelled', 'None'];

  var allProjects = [];

  // Persists the current search/filter/year-pill selection across
  // navigation (sessionStorage, so it's per-tab and clears when the tab
  // closes) — restored on load so clicking into a project and back (or
  // "Refresh Data") lands back on the same filtered view instead of
  // resetting to defaults.
  var FILTER_STATE_KEY = 'capitalProjectsFilterState_v1';

  function saveFilterState() {
    try {
      sessionStorage.setItem(FILTER_STATE_KEY, JSON.stringify({
        search: searchInput.value,
        fund: fundFilter.value,
        phase: phaseFilter.value,
        dept: deptFilter.value,
        status: statusFilter.value,
        year: selectedYear,
      }));
    } catch (err) {
      // Storage full or unavailable — filters just won't persist.
    }
  }

  function readFilterState() {
    try {
      var raw = sessionStorage.getItem(FILTER_STATE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  // Sets a <select>'s value only if that option actually exists (the
  // saved state may name a Fund/Phase/Dept/Status that isn't among this
  // load's populated options) — otherwise leaves it on "All" rather than
  // silently failing to select anything.
  function restoreSelectValue(select, value) {
    if (!value) return;
    var hasOption = Array.prototype.some.call(select.options, function (option) {
      return option.value === value;
    });
    if (hasOption) select.value = value;
  }

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

  function renderRows(projects, showPastSubtotals) {
    tbody.innerHTML = '';

    if (projects.length === 0) {
      var emptyRow = document.createElement('tr');
      var emptyCell = document.createElement('td');
      emptyCell.colSpan = 7;
      emptyCell.textContent = 'No capital projects found.';
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
      return;
    }

    var grantSubtotal = projects.filter(isActiveGrantFundedProject).reduce(function (sum, project) {
      return sum + totalBudget(project);
    }, 0);
    var completedSubtotal = projects.filter(function (project) {
      return isCompletedProject(project);
    }).reduce(function (sum, project) {
      return sum + totalBudget(project);
    }, 0);
    var inProgressSubtotal = projects.filter(function (project) {
      return !isGrantFundedProject(project) && hasStatus(project, 'in progress');
    }).reduce(function (sum, project) {
      return sum + totalBudget(project);
    }, 0);
    var programmedSubtotal = projects.filter(function (project) {
      return !isGrantFundedProject(project) && hasStatus(project, 'programmed');
    }).reduce(function (sum, project) {
      return sum + totalBudget(project);
    }, 0);

    projects.forEach(function (project, index) {
      var row = document.createElement('tr');

      row.appendChild(cell(project.projectCode));

      var nameCell = document.createElement('td');
      var link = document.createElement('a');
      link.className = 'cip-project-link';
      link.href = 'capital-project.html?name=' + encodeURIComponent(project.projectName);
      link.textContent = project.projectName;
      nameCell.appendChild(link);
      row.appendChild(nameCell);

      row.appendChild(cell(project.fund));
      row.appendChild(cell(project.phase));
      var scheduleDate = isCompletedProject(project)
        ? project.estCompletionDate
        : (project.startDate || project.estCompletionDate);
      row.appendChild(cell(formatMonthYear(scheduleDate)));
      row.appendChild(cell(project.status));
      var projectTotal = totalBudget(project);
      var budgetDisplay = selectedYear === 'past' && project.isHistorical && projectTotal === 0
        ? 'No amount recorded'
        : Calculations.formatWholeDollarCurrency(projectTotal);
      row.appendChild(cell(budgetDisplay));
      tbody.appendChild(row);

      var nextProject = projects[index + 1];
      if (showPastSubtotals && isActiveGrantFundedProject(project)
          && (!nextProject || !isActiveGrantFundedProject(nextProject))) {
        var subtotalRow = document.createElement('tr');
        subtotalRow.className = 'cip-grant-subtotal';
        var subtotalLabel = document.createElement('td');
        subtotalLabel.colSpan = 6;
        subtotalLabel.textContent = 'Grant Funded Subtotal';
        subtotalRow.appendChild(subtotalLabel);
        subtotalRow.appendChild(cell(Calculations.formatWholeDollarCurrency(grantSubtotal)));
        tbody.appendChild(subtotalRow);
      }

      var isInProgressNonGrant = !isGrantFundedProject(project) && hasStatus(project, 'in progress');
      var nextIsInProgressNonGrant = nextProject
        && !isGrantFundedProject(nextProject) && hasStatus(nextProject, 'in progress');
      if (showPastSubtotals && isInProgressNonGrant && !nextIsInProgressNonGrant) {
        appendProjectSubtotal('In Progress Projects Subtotal', inProgressSubtotal);
      }

      var isProgrammedNonGrant = !isGrantFundedProject(project) && hasStatus(project, 'programmed');
      var nextIsProgrammedNonGrant = nextProject
        && !isGrantFundedProject(nextProject) && hasStatus(nextProject, 'programmed');
      if (showPastSubtotals && isProgrammedNonGrant && !nextIsProgrammedNonGrant) {
        appendProjectSubtotal('Programmed Projects Subtotal', programmedSubtotal);
      }

      var isCompleted = isCompletedProject(project);
      var nextIsCompleted = nextProject && isCompletedProject(nextProject);
      if (showPastSubtotals && isCompleted && !nextIsCompleted) {
        appendProjectSubtotal('Completed Projects Subtotal', completedSubtotal);
      }
    });
  }

  function appendProjectSubtotal(label, amount) {
    var subtotalRow = document.createElement('tr');
    subtotalRow.className = 'cip-project-subtotal';
    var subtotalLabel = document.createElement('td');
    subtotalLabel.colSpan = 6;
    subtotalLabel.textContent = label;
    subtotalRow.appendChild(subtotalLabel);
    subtotalRow.appendChild(cell(Calculations.formatWholeDollarCurrency(amount)));
    tbody.appendChild(subtotalRow);
  }

  function matchesFilters(project) {
    var query = searchInput.value.trim().toLowerCase();
    if (query && project.projectName.toLowerCase().indexOf(query) === -1) return false;
    if (fundFilter.value !== 'All' && project.fund !== fundFilter.value) return false;
    if (phaseFilter.value !== 'All' && project.phase !== phaseFilter.value) return false;
    if (deptFilter.value !== 'All' && project.dept !== deptFilter.value) return false;
    if (statusFilter.value !== 'All' && project.status !== statusFilter.value) return false;
    if (selectedYear === 'past') {
      var hasHistoricalAmount = PAST_CIP_FY_FIELDS.some(function (field) { return project[field] > 0; });
      var hasFutureAmount = FUTURE_CIP_FY_FIELDS.some(function (field) { return project[field] > 0; });
      var isStatusOnlyHistoricalProject = project.isHistorical && !hasFutureAmount;
      if (!hasHistoricalAmount && !isStatusOnlyHistoricalProject) return false;
    } else if (selectedYear !== 'All' && !(project[selectedYear] > 0)) {
      return false;
    }
    return true;
  }

  function applyFilters() {
    var filteredProjects = allProjects.filter(matchesFilters);
    if (selectedYear === 'past') {
      filteredProjects = filteredProjects.map(function (project, index) {
        return { project: project, index: index };
      }).sort(function (a, b) {
        var grantDifference = Number(isActiveGrantFundedProject(b.project))
          - Number(isActiveGrantFundedProject(a.project));
        if (grantDifference) return grantDifference;
        var statusOrder = {
          'in progress': 0,
          'programmed': 1,
          'complete': 3,
          'completed': 3,
        };
        var aStatus = String(a.project.status || '').trim().toLowerCase();
        var bStatus = String(b.project.status || '').trim().toLowerCase();
        var aRank = statusOrder[aStatus] === undefined ? 2 : statusOrder[aStatus];
        var bRank = statusOrder[bStatus] === undefined ? 2 : statusOrder[bStatus];
        return aRank - bRank || a.index - b.index;
      }).map(function (item) { return item.project; });
    }
    renderRows(filteredProjects, selectedYear === 'past');
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

  // Clears every <option> except the first ("All") — needed because
  // loadProjects() can now run more than once (Refresh Data), and
  // populateFilter() only appends.
  function resetFilterOptions(select) {
    while (select.options.length > 1) {
      select.remove(1);
    }
  }

  function populateFilter(select, options) {
    options.forEach(function (option) {
      var optionEl = document.createElement('option');
      optionEl.value = option;
      optionEl.textContent = option;
      select.appendChild(optionEl);
    });
  }

  function loadProjects(forceRefresh) {
    tbody.innerHTML = '<tr><td colspan="7">Loading capital projects...</td></tr>';
    var savedState = readFilterState();
    var request = forceRefresh ? CapitalProjects.refresh() : CapitalProjects.getProjects();
    request
      .then(function (projects) {
        hideApiError();
        allProjects = projects;

        resetFilterOptions(fundFilter);
        resetFilterOptions(phaseFilter);
        resetFilterOptions(deptFilter);
        resetFilterOptions(statusFilter);

        populateFilter(fundFilter, uniqueSorted(projects.map(function (p) { return p.fund; })));
        populateFilter(phaseFilter, uniqueSorted(projects.map(function (p) { return p.phase; })));
        populateFilter(deptFilter, uniqueSorted(projects.map(function (p) { return p.dept; })));
        // Fixed options first, then any other status value actually found
        // in the data that isn't already one of them (e.g. a typo, or one
        // set before this list existed) — so nothing is ever unreachable
        // through this filter.
        var extraStatuses = uniqueSorted(projects.map(function (p) { return p.status; }))
          .filter(function (status) { return STATUS_OPTIONS.indexOf(status) === -1; });
        populateFilter(statusFilter, STATUS_OPTIONS.concat(extraStatuses));

        restoreSelectValue(fundFilter, savedState && savedState.fund);
        restoreSelectValue(phaseFilter, savedState && savedState.phase);
        restoreSelectValue(deptFilter, savedState && savedState.dept);
        restoreSelectValue(statusFilter, savedState && savedState.status);

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
    // Search box and the year pill row don't depend on data being loaded
    // first (unlike the Fund/Phase/Dept/Status <select>s, whose options
    // are only populated once projects come back — see restoreSelectValue
    // in loadProjects), so they're restored immediately.
    var savedState = readFilterState();
    if (savedState) {
      searchInput.value = savedState.search || '';
      if (savedState.year) {
        selectedYear = savedState.year;
        yearFilterPills.querySelectorAll('.cip-year-pill').forEach(function (pill) {
          pill.classList.toggle('is-active', pill.dataset.year === selectedYear);
        });
      }
    }

    loadProjects();

    searchInput.addEventListener('input', function () {
      applyFilters();
      saveFilterState();
    });
    [fundFilter, phaseFilter, deptFilter, statusFilter].forEach(function (select) {
      select.addEventListener('change', function () {
        applyFilters();
        saveFilterState();
      });
    });

    yearFilterPills.querySelectorAll('.cip-year-pill').forEach(function (pill) {
      pill.addEventListener('click', function () {
        selectedYear = pill.dataset.year;
        yearFilterPills.querySelectorAll('.cip-year-pill').forEach(function (other) {
          other.classList.toggle('is-active', other === pill);
        });
        applyFilters();
        saveFilterState();
      });
    });

    refreshBtn.addEventListener('click', function () { loadProjects(true); });
  }

  init();
})(window.BudgetApp.CapitalProjects, window.BudgetApp.Calculations);
