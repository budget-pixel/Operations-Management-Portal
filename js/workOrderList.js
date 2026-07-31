/* =============================================================
   workOrderList.js
   Drives work-order-list.html: loads work orders from the API,
   renders them as a table, and lets anyone update a work order's
   status or assignment inline (no roles yet — see the Work Orders
   module's v1 scope). Built with DOM methods rather than innerHTML
   since row content (summary, requester name, etc.) is user-submitted.

   Depends on: window.BudgetApp.WorkOrderApi
   ============================================================= */

(function (WorkOrderApi) {
  'use strict';

  var apiStatusBanner = document.getElementById('apiStatusBanner');
  var statusFilter = document.getElementById('statusFilter');
  var locationFilter = document.getElementById('locationFilter');
  var categoryFilter = document.getElementById('categoryFilter');
  var priorityFilter = document.getElementById('priorityFilter');
  var tbody = document.getElementById('workOrdersBody');

  var STATUSES = [];
  var ASSIGNEES = [];

  function showApiError(message) {
    apiStatusBanner.className = 'banner banner-error no-print';
    apiStatusBanner.textContent = message;
    apiStatusBanner.hidden = false;
  }

  function formatDate(isoString) {
    var date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return date.toLocaleString();
  }

  function cell(text) {
    var td = document.createElement('td');
    td.textContent = text;
    return td;
  }

  function buildStatusCell(workOrder) {
    var td = document.createElement('td');

    var select = document.createElement('select');
    STATUSES.forEach(function (status) {
      var option = document.createElement('option');
      option.value = status;
      option.textContent = status;
      option.selected = status === workOrder.status;
      select.appendChild(option);
    });

    var savedNote = document.createElement('span');
    savedNote.className = 'field-hint';
    savedNote.style.display = 'block';

    select.addEventListener('change', function () {
      savedNote.textContent = 'Saving...';
      WorkOrderApi.update(workOrder.id, { status: select.value })
        .then(function () {
          savedNote.textContent = 'Saved.';
        })
        .catch(function (err) {
          savedNote.textContent = err.message;
          select.value = workOrder.status;
        });
    });

    td.appendChild(select);
    td.appendChild(savedNote);
    return td;
  }

  function buildAssignedToCell(workOrder) {
    var td = document.createElement('td');

    var select = document.createElement('select');

    var unassignedOption = document.createElement('option');
    unassignedOption.value = '';
    unassignedOption.textContent = 'Unassigned';
    unassignedOption.selected = !workOrder.assigned_to;
    select.appendChild(unassignedOption);

    ASSIGNEES.forEach(function (name) {
      var option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      option.selected = name === workOrder.assigned_to;
      select.appendChild(option);
    });

    var savedNote = document.createElement('span');
    savedNote.className = 'field-hint';
    savedNote.style.display = 'block';

    select.addEventListener('change', function () {
      savedNote.textContent = 'Saving...';
      WorkOrderApi.update(workOrder.id, { assignedTo: select.value || null })
        .then(function (result) {
          workOrder.assigned_to = result.workOrder.assigned_to;
          savedNote.textContent = 'Saved.';
        })
        .catch(function (err) {
          savedNote.textContent = err.message;
          select.value = workOrder.assigned_to || '';
        });
    });

    td.appendChild(select);
    td.appendChild(savedNote);
    return td;
  }

  function renderRows(workOrders) {
    tbody.innerHTML = '';

    if (workOrders.length === 0) {
      var emptyRow = document.createElement('tr');
      var emptyCell = document.createElement('td');
      emptyCell.colSpan = 8;
      emptyCell.textContent = 'No work orders found.';
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
      return;
    }

    workOrders.forEach(function (workOrder) {
      var row = document.createElement('tr');
      row.appendChild(cell(String(workOrder.id)));
      row.appendChild(cell(workOrder.title));
      row.appendChild(cell(workOrder.location));
      row.appendChild(cell(workOrder.category));
      row.appendChild(cell(workOrder.priority));
      row.appendChild(buildStatusCell(workOrder));
      row.appendChild(buildAssignedToCell(workOrder));
      row.appendChild(cell(formatDate(workOrder.created_at)));
      tbody.appendChild(row);
    });
  }

  function loadWorkOrders() {
    tbody.innerHTML = '<tr><td colspan="8">Loading work orders...</td></tr>';
    WorkOrderApi.list({
      status: statusFilter.value,
      location: locationFilter.value,
      category: categoryFilter.value,
      priority: priorityFilter.value,
    })
      .then(function (result) {
        renderRows(result.workOrders);
      })
      .catch(function (err) {
        tbody.innerHTML = '';
        showApiError(err.message);
      });
  }

  function populateFilter(select, options) {
    options.forEach(function (option) {
      var optionEl = document.createElement('option');
      optionEl.value = option;
      optionEl.textContent = option;
      select.appendChild(optionEl);
    });
  }

  function init() {
    WorkOrderApi.getMeta()
      .then(function (meta) {
        STATUSES = meta.statuses;
        ASSIGNEES = meta.assignees;
        populateFilter(statusFilter, meta.statuses);
        populateFilter(locationFilter, meta.locations);
        populateFilter(categoryFilter, meta.categories);
        populateFilter(priorityFilter, meta.priorities);
        return loadWorkOrders();
      })
      .catch(function (err) {
        showApiError(err.message);
      });

    [statusFilter, locationFilter, categoryFilter, priorityFilter].forEach(function (select) {
      select.addEventListener('change', loadWorkOrders);
    });
  }

  init();
})(window.BudgetApp.WorkOrderApi);
