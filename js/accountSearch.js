/* =============================================================
   accountSearch.js
   A generic, accessible searchable combobox widget (WAI-ARIA
   combobox + listbox pattern). Reused for both the department
   selector(s) and every Transfer From/To account selector — the
   only thing that differs between uses is the getResults()
   function each caller supplies.

   Exposes: window.BudgetApp.AccountSearch
   ============================================================= */

window.BudgetApp = window.BudgetApp || {};

window.BudgetApp.AccountSearch = (function () {
  'use strict';

  /**
   * @param {Object} config
   * @param {HTMLInputElement} config.inputEl
   * @param {HTMLElement} config.listboxEl   <ul role="listbox">
   * @param {HTMLElement} [config.clearBtnEl]  optional × button
   * @param {HTMLElement} [config.wrapperEl]   click-outside boundary (defaults to inputEl.parentElement)
   * @param {function(string): Array} config.getResults
   *        Returns items: { id, label, sublabel, group, data }
   * @param {function(Object|null)} config.onSelect
   *        Called with the selected item's `data`, or null when cleared.
   * @param {string} [config.emptyMessage]
   */
  function createCombobox(config) {
    var inputEl = config.inputEl;
    var listboxEl = config.listboxEl;
    var clearBtnEl = config.clearBtnEl || null;
    var wrapperEl = config.wrapperEl || inputEl.parentElement;
    var getResults = config.getResults;
    var onSelect = config.onSelect || function () {};
    var emptyMessage = config.emptyMessage || 'No matches found.';

    var isOpen = false;
    var flatOptions = []; // currently rendered selectable items, in DOM order
    var activeIndex = -1;
    var selectedItem = null;

    if (!listboxEl.id) {
      listboxEl.id = 'listbox-' + Math.random().toString(36).slice(2);
    }
    inputEl.setAttribute('role', 'combobox');
    inputEl.setAttribute('aria-expanded', 'false');
    inputEl.setAttribute('aria-controls', listboxEl.id);
    inputEl.setAttribute('aria-autocomplete', 'list');
    inputEl.setAttribute('autocomplete', 'off');

    function optionId(index) {
      return inputEl.id + '-opt-' + index;
    }

    function closeDropdown() {
      isOpen = false;
      activeIndex = -1;
      listboxEl.hidden = true;
      inputEl.setAttribute('aria-expanded', 'false');
      inputEl.removeAttribute('aria-activedescendant');
    }

    function renderResults(query) {
      var items = getResults(query) || [];
      listboxEl.innerHTML = '';
      flatOptions = [];
      activeIndex = -1;

      if (items.length === 0) {
        var emptyEl = document.createElement('li');
        emptyEl.className = 'combobox-empty';
        emptyEl.setAttribute('role', 'presentation');
        emptyEl.textContent = emptyMessage;
        listboxEl.appendChild(emptyEl);
      } else {
        var lastGroup;
        items.forEach(function (item) {
          if (item.group && item.group !== lastGroup) {
            var groupEl = document.createElement('li');
            groupEl.className = 'combobox-group-label';
            groupEl.setAttribute('role', 'presentation');
            groupEl.textContent = item.group;
            listboxEl.appendChild(groupEl);
          }
          lastGroup = item.group || lastGroup;

          var index = flatOptions.length;
          var optEl = document.createElement('li');
          optEl.id = optionId(index);
          optEl.className = 'combobox-option';
          optEl.setAttribute('role', 'option');
          optEl.setAttribute('aria-selected', 'false');

          var labelEl = document.createElement('span');
          labelEl.className = 'combobox-option-label';
          labelEl.textContent = item.label;
          optEl.appendChild(labelEl);

          if (item.sublabel) {
            var subEl = document.createElement('span');
            subEl.className = 'combobox-option-sublabel';
            subEl.textContent = item.sublabel;
            optEl.appendChild(subEl);
          }

          optEl.addEventListener('click', function () {
            selectItem(item);
          });

          listboxEl.appendChild(optEl);
          flatOptions.push(item);
        });
      }

      isOpen = true;
      listboxEl.hidden = false;
      inputEl.setAttribute('aria-expanded', 'true');
    }

    function highlight(index) {
      var options = listboxEl.querySelectorAll('.combobox-option');
      options.forEach(function (el) { el.classList.remove('is-active'); el.setAttribute('aria-selected', 'false'); });

      if (index < 0 || index >= options.length) {
        activeIndex = -1;
        inputEl.removeAttribute('aria-activedescendant');
        return;
      }

      activeIndex = index;
      var activeEl = options[index];
      activeEl.classList.add('is-active');
      activeEl.setAttribute('aria-selected', 'true');
      inputEl.setAttribute('aria-activedescendant', activeEl.id);
      activeEl.scrollIntoView({ block: 'nearest' });
    }

    function selectItem(item) {
      selectedItem = item;
      inputEl.value = item.label;
      closeDropdown();
      if (clearBtnEl) clearBtnEl.hidden = false;
      onSelect(item.data);
    }

    // notify=false is used when clearing as a side effect of a parent's
    // own state change (e.g. department switched) to avoid re-entrant calls.
    function clearSelection(notify) {
      selectedItem = null;
      inputEl.value = '';
      if (clearBtnEl) clearBtnEl.hidden = true;
      closeDropdown();
      if (notify !== false) onSelect(null);
    }

    // Programmatically restores a selection (e.g. from a saved draft)
    // without firing onSelect, since the caller already has the data.
    function setSelection(item) {
      if (!item) {
        clearSelection(false);
        return;
      }
      selectedItem = item;
      inputEl.value = item.label;
      if (clearBtnEl) clearBtnEl.hidden = false;
    }

    function setDisabled(disabled) {
      inputEl.disabled = disabled;
      if (clearBtnEl) clearBtnEl.disabled = disabled;
      if (disabled) {
        clearSelection(false);
      }
    }

    inputEl.addEventListener('input', function () {
      if (selectedItem) {
        selectedItem = null;
        if (clearBtnEl) clearBtnEl.hidden = true;
        onSelect(null);
      }
      renderResults(inputEl.value);
    });

    inputEl.addEventListener('focus', function () {
      if (!inputEl.disabled) renderResults(inputEl.value);
    });

    inputEl.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (!isOpen) { renderResults(inputEl.value); return; }
        highlight(Math.min(activeIndex + 1, flatOptions.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (!isOpen) { renderResults(inputEl.value); return; }
        highlight(Math.max(activeIndex - 1, 0));
      } else if (event.key === 'Home' && isOpen) {
        event.preventDefault();
        highlight(0);
      } else if (event.key === 'End' && isOpen) {
        event.preventDefault();
        highlight(flatOptions.length - 1);
      } else if (event.key === 'Enter') {
        if (isOpen) {
          event.preventDefault();
          if (activeIndex >= 0 && flatOptions[activeIndex]) {
            selectItem(flatOptions[activeIndex]);
          } else if (flatOptions.length === 1) {
            selectItem(flatOptions[0]);
          }
        }
      } else if (event.key === 'Escape') {
        if (isOpen) {
          event.preventDefault();
          closeDropdown();
        }
      }
    });

    // Prevent the input's blur from firing before a click on an option
    // registers (the standard combobox listbox trick).
    listboxEl.addEventListener('mousedown', function (event) {
      event.preventDefault();
    });

    inputEl.addEventListener('blur', function () {
      window.setTimeout(closeDropdown, 100);
    });

    document.addEventListener('click', function (event) {
      if (isOpen && wrapperEl && !wrapperEl.contains(event.target)) {
        closeDropdown();
      }
    });

    if (clearBtnEl) {
      clearBtnEl.hidden = true;
      clearBtnEl.addEventListener('click', function () {
        clearSelection(true);
        inputEl.focus();
      });
    }

    return {
      setSelection: setSelection,
      clearSelection: clearSelection,
      setDisabled: setDisabled,
      getSelection: function () { return selectedItem ? selectedItem.data : null; },
      refresh: function () { if (isOpen) renderResults(inputEl.value); },
    };
  }

  return {
    createCombobox: createCombobox,
  };
})();
