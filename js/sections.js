/* =============================================================
   sections.js
   Renders a page's card grid from a plain data object instead of
   hand-written markup. SECTIONS maps a <body data-page="..."> value
   to the list of cards that page shows — the home page's six module
   cards, plus each module's own landing page (Budget Management ->
   Budget Request / Rollforward Request, etc). Adding a new module or
   request type means adding an entry here, not editing HTML.

   Exposes: window.BudgetApp.Sections
   ============================================================= */

window.BudgetApp = window.BudgetApp || {};

window.BudgetApp.Sections = (function () {
  'use strict';

  var SECTIONS = {
    home: [
      {
        title: 'Budget Management',
        description: 'Transfer or amend budget between accounts, or roll unspent budget into the next fiscal year.',
        href: 'budget-management.html',
        buttonLabel: 'Open Budget Management',
      },
      {
        title: 'Grant Management',
        description: 'Submit grant amendment requests — revenue and expense accounts are auto-filled from the grant’s source and activity.',
        href: 'grant-management.html',
        buttonLabel: 'Open Grant Management',
      },
      {
        title: 'Project Management',
        description: 'Track capital and operating projects from initiation through closeout.',
        href: 'project-management.html',
        buttonLabel: 'Open Project Management',
      },
      {
        title: 'Asset Tracking',
        description: 'Maintain a record of county assets, locations, and assignment history.',
        href: 'asset-tracking.html',
        buttonLabel: 'Open Asset Tracking',
      },
      {
        title: 'Work Orders',
        description: 'Create and track work orders for maintenance and facility requests.',
        href: 'work-orders.html',
        buttonLabel: 'Open Work Orders',
      },
      {
        title: 'Reports & Analytics',
        description: 'View dashboards and run reports across budget, grant, and project activity.',
        href: 'reports-analytics.html',
        buttonLabel: 'Open Reports & Analytics',
      },
    ],

    'budget-management': [
      {
        title: 'Budget Request',
        description: 'Transfer existing budget between accounts or amend the current fiscal year budget.',
        href: 'transfer.html',
        buttonLabel: 'Start Budget Request',
      },
      {
        title: 'Rollforward Request',
        description: 'Request authorization to roll unspent budget into the next fiscal year.',
        href: 'rollforward.html',
        buttonLabel: 'Start Rollforward Request',
      },
    ],

    'grant-management': [
      {
        title: 'Grant Amendment Request',
        description: 'Submit a grant amendment — revenue and expense accounts are auto-filled from the grant’s source and activity.',
        href: 'grant.html',
        buttonLabel: 'Start Grant Amendment Request',
      },
    ],

    'project-management': [],
    'asset-tracking': [],

    'work-orders': [
      {
        title: 'New Work Order Request',
        description: 'Report a maintenance issue — describe the problem, its location, and how urgent it is.',
        href: 'work-order-request.html',
        buttonLabel: 'Start Work Order Request',
      },
      {
        title: 'Track Work Orders',
        description: 'View all submitted work orders and update their status or assignment.',
        href: 'work-order-list.html',
        buttonLabel: 'View Work Orders',
      },
      {
        title: 'Admin',
        description: 'Manage the Locations, Categories, and Assignees lists used on the request and tracking pages.',
        href: 'work-order-admin.html',
        buttonLabel: 'Open Admin',
      },
    ],

    'reports-analytics': [],
  };

  function render() {
    var container = document.getElementById('landingCards');
    if (!container) return;

    var currentPage = document.body.dataset.page;
    var cards = SECTIONS[currentPage] || [];

    container.innerHTML = '';

    if (cards.length === 0) {
      var placeholder = document.createElement('p');
      placeholder.className = 'coming-soon';
      placeholder.textContent = 'This section is coming soon.';
      container.appendChild(placeholder);
      return;
    }

    cards.forEach(function (type) {
      var card = document.createElement('div');
      card.className = 'card landing-card';

      var heading = document.createElement('h2');
      heading.textContent = type.title;
      card.appendChild(heading);

      var description = document.createElement('p');
      description.textContent = type.description;
      card.appendChild(description);

      var link = document.createElement('a');
      link.href = type.href;
      link.className = 'btn btn-primary';
      link.textContent = type.buttonLabel;
      card.appendChild(link);

      container.appendChild(card);
    });
  }

  render();

  return {
    render: render,
  };
})();
