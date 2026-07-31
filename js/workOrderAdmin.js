/* =============================================================
   workOrderAdmin.js
   Drives work-order-admin.html: renders one management panel per
   admin-managed list (Locations, Categories, Assignees) from the
   RESOURCES array below — each panel lists current entries with a
   delete button, plus an add form. Adding a fourth managed list
   later means adding one entry here, not hand-writing more markup.

   Depends on: window.BudgetApp.WorkOrderApi
   ============================================================= */

(function (WorkOrderApi) {
  'use strict';

  var RESOURCES = [
    { resource: 'locations', title: 'Locations', placeholder: 'e.g., Courthouse - Suite 210' },
    { resource: 'categories', title: 'Categories', placeholder: 'e.g., Electrical' },
    { resource: 'assignees', title: 'Assignees', placeholder: 'e.g., Facilities - J. Smith' },
  ];

  var apiStatusBanner = document.getElementById('apiStatusBanner');
  var container = document.getElementById('adminPanels');

  function showApiError(message) {
    apiStatusBanner.className = 'banner banner-error no-print';
    apiStatusBanner.textContent = message;
    apiStatusBanner.hidden = false;
  }

  function buildPanel(config) {
    var card = document.createElement('div');
    card.className = 'card';

    var body = document.createElement('div');
    body.className = 'card-body';
    card.appendChild(body);

    var heading = document.createElement('h2');
    heading.className = 'section-title';
    heading.textContent = config.title;
    body.appendChild(heading);

    var list = document.createElement('ul');
    list.style.listStyle = 'none';
    list.style.padding = '0';
    list.style.margin = '0 0 1rem';
    body.appendChild(list);

    var errorText = document.createElement('p');
    errorText.className = 'error-text';
    body.appendChild(errorText);

    var form = document.createElement('form');
    form.className = 'grid-2';
    form.setAttribute('novalidate', '');

    var input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 100;
    input.placeholder = config.placeholder;
    input.setAttribute('aria-label', 'New ' + config.title.replace(/s$/, ''));

    var addBtn = document.createElement('button');
    addBtn.type = 'submit';
    addBtn.className = 'btn btn-secondary';
    addBtn.textContent = 'Add';

    form.appendChild(input);
    form.appendChild(addBtn);
    body.appendChild(form);

    function renderItems(items) {
      list.innerHTML = '';
      if (items.length === 0) {
        var emptyItem = document.createElement('li');
        emptyItem.className = 'field-hint';
        emptyItem.textContent = 'None added yet.';
        list.appendChild(emptyItem);
        return;
      }

      items.forEach(function (item) {
        var li = document.createElement('li');
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';
        li.style.alignItems = 'center';
        li.style.padding = '0.4rem 0';
        li.style.borderBottom = '1px solid var(--color-line)';

        var nameSpan = document.createElement('span');
        nameSpan.textContent = item.name;
        li.appendChild(nameSpan);

        var deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn btn-danger no-print';
        deleteBtn.textContent = 'Remove';
        deleteBtn.addEventListener('click', function () {
          deleteBtn.disabled = true;
          WorkOrderApi.deleteResourceItem(config.resource, item.id)
            .then(load)
            .catch(function (err) {
              errorText.textContent = err.message;
              deleteBtn.disabled = false;
            });
        });
        li.appendChild(deleteBtn);

        list.appendChild(li);
      });
    }

    function load() {
      return WorkOrderApi.listResource(config.resource)
        .then(function (result) {
          renderItems(result[config.resource]);
        })
        .catch(function (err) {
          showApiError(err.message);
        });
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var name = input.value.trim();
      errorText.textContent = '';
      if (!name) return;

      addBtn.disabled = true;
      WorkOrderApi.createResourceItem(config.resource, name)
        .then(function () {
          input.value = '';
          return load();
        })
        .catch(function (err) {
          errorText.textContent = err.message;
        })
        .finally(function () {
          addBtn.disabled = false;
        });
    });

    container.appendChild(card);
    load();
  }

  RESOURCES.forEach(buildPanel);
})(window.BudgetApp.WorkOrderApi);
