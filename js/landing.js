/* =============================================================
   landing.js
   Renders the landing page's request-type cards from a plain data
   array instead of hand-written markup — adding a third (or
   fourth, ...) request type later means adding one entry to
   REQUEST_TYPES, not editing index.html. Pairs with the
   .landing-cards CSS grid (css/styles.css), which auto-fits
   however many cards exist instead of assuming exactly two.

   Exposes: window.BudgetApp.Landing
   ============================================================= */

window.BudgetApp = window.BudgetApp || {};

window.BudgetApp.Landing = (function () {
  'use strict';

  // Add future request types here — title, description, the page it
  // links to, and its button label. Nothing else needs to change.
  var REQUEST_TYPES = [
    {
      title: 'Budget Transfer / Amendment Request',
      description: 'Transfer existing budget between accounts or amend the current fiscal year budget.',
      href: 'transfer.html',
      buttonLabel: 'Start Budget Transfer',
    },
    {
      title: 'Fiscal Year Rollforward Request',
      description: 'Request authorization to roll unspent budget into the next fiscal year.',
      href: 'rollforward.html',
      buttonLabel: 'Start Rollforward Request',
    },
  ];

  function render() {
    var container = document.getElementById('landingCards');
    if (!container) return;

    container.innerHTML = '';

    REQUEST_TYPES.forEach(function (type) {
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
