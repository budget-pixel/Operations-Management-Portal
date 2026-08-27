/* =============================================================
   nav.js
   Renders the shared portal navigation (one link per module) into a
   page's <nav id="siteNav">, with the current module highlighted.
   The brand/seal link in the header already goes home, so there's no
   separate Home link here. One source of truth for the nav markup
   instead of copy-pasting it into every page.

   Each page sets <body data-page="..."> so this module knows which
   link to mark active. Request-type pages nested under a module
   (transfer, grant, rollforward) set data-page to their *parent*
   module key, so the nav highlights that module while they're open.

   Exposes: window.BudgetApp.Nav
   ============================================================= */

window.BudgetApp = window.BudgetApp || {};

window.BudgetApp.Nav = (function () {
  'use strict';

  var LINKS = [
    { page: 'budget-management', href: 'budget-management.html', label: 'Budget' },
    { page: 'grant-management', href: 'grant-management.html', label: 'Grant' },
    // Project Management has exactly one thing in it (Capital Improvement
    // Projects) and isn't expected to grow, so the nav link skips its
    // landing page and goes straight there — 'page' still matches
    // project-management.html/capital-projects.html/capital-project.html's
    // data-page="project-management" for the active-link highlight.
    { page: 'project-management', href: 'capital-projects.html', label: 'Project' },
    { page: 'asset-tracking', href: 'asset-tracking.html', label: 'Asset Tracking' },
    { page: 'work-orders', href: 'work-orders.html', label: 'Work Orders' },
    { page: 'reports-analytics', href: 'reports-analytics.html', label: 'Reports & Analytics' },
  ];

  function render() {
    var navEl = document.getElementById('siteNav');
    if (!navEl) return;

    var currentPage = document.body.dataset.page;

    navEl.innerHTML = '';
    navEl.className = 'site-nav';

    LINKS.forEach(function (link) {
      var a = document.createElement('a');
      a.href = link.href;
      a.textContent = link.label;
      if (link.page === currentPage) {
        a.classList.add('is-active');
        a.setAttribute('aria-current', 'page');
      }
      navEl.appendChild(a);
    });

    var toggle = document.querySelector('.nav-menu-toggle');
    var header = document.querySelector('.site-header');
    if (toggle && header) {
      toggle.addEventListener('click', function () {
        var open = !header.classList.contains('is-menu-open');
        header.classList.toggle('is-menu-open', open);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
      });
    }
  }

  render();

  return {
    render: render,
  };
})();
