/* =============================================================
   nav.js
   Renders the shared portal navigation (Home / Budget Transfer /
   Rollforward Request) into a page's <nav id="siteNav">, with the
   current page highlighted. One source of truth for the nav
   markup instead of copy-pasting it into every page.

   Each page sets <body data-page="home|transfer|rollforward"> so
   this module knows which link to mark active.

   Exposes: window.BudgetApp.Nav
   ============================================================= */

window.BudgetApp = window.BudgetApp || {};

window.BudgetApp.Nav = (function () {
  'use strict';

  var LINKS = [
    { page: 'home', href: 'index.html', label: 'Home' },
    { page: 'transfer', href: 'transfer.html', label: 'Budget Transfer' },
    { page: 'rollforward', href: 'rollforward.html', label: 'Rollforward Request' },
  ];

  function render() {
    var navEl = document.getElementById('siteNav');
    if (!navEl) return;

    var currentPage = document.body.dataset.page;

    navEl.innerHTML = '';
    navEl.className = 'site-nav no-print';
    navEl.setAttribute('aria-label', 'Budget Management Portal');

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
  }

  render();

  return {
    render: render,
  };
})();
