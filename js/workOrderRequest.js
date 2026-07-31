/* =============================================================
   workOrderRequest.js
   Drives work-order-request.html: loads category/priority options
   from the Work Orders API, validates the form, and submits a new
   work order request.

   Depends on: window.BudgetApp.WorkOrderApi
   ============================================================= */

(function (WorkOrderApi) {
  'use strict';

  var form = document.getElementById('workOrderForm');
  var submitBtn = document.getElementById('submitBtn');
  var apiStatusBanner = document.getElementById('apiStatusBanner');
  var statusBanner = document.getElementById('statusBanner');
  var categorySelect = document.getElementById('category');
  var prioritySelect = document.getElementById('priority');
  var locationSelect = document.getElementById('location');
  var noLocationsHint = document.getElementById('noLocationsHint');

  var fields = {
    requesterName: document.getElementById('requesterName'),
    requesterEmail: document.getElementById('requesterEmail'),
    title: document.getElementById('title'),
    location: document.getElementById('location'),
    category: categorySelect,
    priority: prioritySelect,
    description: document.getElementById('description'),
  };

  function setFieldError(input, message) {
    var errorEl = document.getElementById(input.id + '-error');
    if (message) {
      input.setAttribute('aria-invalid', 'true');
      errorEl.textContent = message;
    } else {
      input.removeAttribute('aria-invalid');
      errorEl.textContent = '';
    }
  }

  function validateRequired(input, label) {
    if (!input.value.trim()) {
      setFieldError(input, label + ' is required.');
      return false;
    }
    setFieldError(input, '');
    return true;
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  }

  function validateForm() {
    var valid = true;

    valid = validateRequired(fields.requesterName, 'Requester name') && valid;
    valid = validateRequired(fields.title, 'Summary') && valid;
    valid = validateRequired(fields.location, 'Location') && valid;
    valid = validateRequired(fields.category, 'Category') && valid;
    valid = validateRequired(fields.priority, 'Priority') && valid;
    valid = validateRequired(fields.description, 'Description') && valid;

    if (!fields.requesterEmail.value.trim()) {
      setFieldError(fields.requesterEmail, 'Requester email is required.');
      valid = false;
    } else if (!isValidEmail(fields.requesterEmail.value)) {
      setFieldError(fields.requesterEmail, 'Enter a valid email address.');
      valid = false;
    } else {
      setFieldError(fields.requesterEmail, '');
    }

    return valid;
  }

  function showBanner(el, message, variant) {
    el.className = 'banner no-print ' + variant;
    el.textContent = message;
    el.hidden = false;
  }

  function hideBanner(el) {
    el.hidden = true;
    el.textContent = '';
  }

  function populateSelect(select, options) {
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
        populateSelect(categorySelect, meta.categories);
        populateSelect(prioritySelect, meta.priorities);
        populateSelect(locationSelect, meta.locations);

        if (meta.locations.length === 0) {
          noLocationsHint.hidden = false;
          locationSelect.disabled = true;
          submitBtn.disabled = true;
        }
      })
      .catch(function (err) {
        showBanner(apiStatusBanner, err.message, 'banner-error');
        submitBtn.disabled = true;
      });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    hideBanner(statusBanner);

    if (!validateForm()) {
      return;
    }

    submitBtn.disabled = true;

    WorkOrderApi.create({
      requesterName: fields.requesterName.value.trim(),
      requesterEmail: fields.requesterEmail.value.trim(),
      title: fields.title.value.trim(),
      location: fields.location.value.trim(),
      category: fields.category.value,
      priority: fields.priority.value,
      description: fields.description.value.trim(),
    })
      .then(function (result) {
        showBanner(
          statusBanner,
          'Work order request submitted. Reference ' + result.workOrder.id + '.',
          'banner-success'
        );
        form.reset();
      })
      .catch(function (err) {
        showBanner(statusBanner, err.message, 'banner-error');
      })
      .finally(function () {
        submitBtn.disabled = false;
      });
  });

  init();
})(window.BudgetApp.WorkOrderApi);
