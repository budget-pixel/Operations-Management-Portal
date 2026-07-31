/* =============================================================
   nav.js
   Renders the shared portal navigation (Home / Budget Request / Grant
   Amendment Request / Rollforward Request) into a page's
   <nav id="siteNav">, with the current page highlighted. One source of
   truth for the nav markup instead of copy-pasting it into every page.

   Each page sets <body data-page="home|transfer|grant|rollforward"> so
   this module knows which link to mark active.

   Exposes: window.BudgetApp.Nav
   ============================================================= */

window.BudgetApp = window.BudgetApp || {};

window.BudgetApp.Nav = (function () {
  'use strict';

  var LINKS = [
    { page: 'home', href: 'index.html', label: 'Home' },
    { page: 'transfer', href: 'transfer.html', label: 'Budget Request' },
    { page: 'grant', href: 'grant.html', label: 'Grant Amendment Request' },
    { page: 'rollforward', href: 'rollforward.html', label: 'Rollforward Request' },
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
