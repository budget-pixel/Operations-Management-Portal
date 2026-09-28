/* =============================================================
   auth.js
   Shared Microsoft Entra ID (Azure AD) sign-in for the Operations
   Portal — the multi-page successor to auth-poc.html's proof of
   concept. Any page that includes this script (after MSAL's own
   <script> tag) is gated: an unauthenticated visitor is redirected
   to Microsoft's login before the page's own content/scripts run.

   Unlike the POC (memoryStorage, re-login on every navigation),
   this uses sessionStorage so a signed-in visitor can move between
   pages in the same tab without re-authenticating each time — same
   persistence model as the rest of this app's per-tab caches
   (js/capitalProjects.js, js/googleSheets.js).

   Redirect-URI design: only ONE URI needs to be registered in the
   Azure AD app registration — this app's index.html — rather than
   every individual page. A protected page that finds no session
   stores its own URL (sessionStorage) and redirects to Microsoft
   sign-in with redirectUri pointed at index.html; index.html's own
   init() (see bottom of this file) notices a pending return URL
   after a successful login and forwards the browser there.

   Exposes: window.BudgetApp.Auth = {
     ready:            Promise, resolves once init has run (account
                        may or may not be present — check isSignedIn()).
     isSignedIn:        () => boolean
     getAccount:        () => MSAL AccountInfo | null
     getAccessToken:    () => Promise<string> — a Microsoft Graph
                        access token (scope User.Read), silently
                        refreshed; sent to Apps Script backends so
                        they can verify the caller via Graph's /me
                        endpoint (see docs/apps-script/CapitalProjectsCode.gs).
     signOut:           () => void
   }

   Depends on: the MSAL Browser <script> tag (see auth-poc.html for
   the CDN URL) loaded BEFORE this file.
   ============================================================= */

window.BudgetApp = window.BudgetApp || {};

window.BudgetApp.Auth = (function () {
  'use strict';

  // Same Entra ID app registration as auth-poc.html's proof of
  // concept — one app registration covers the whole portal, not one
  // per page. Update these (and the Azure Portal's redirect URI
  // list) if the app registration ever changes.
  var msalConfig = {
    auth: {
      clientId: '8992b3aa-a4c7-42cb-8daa-2730c8979ec3',
      authority: 'https://login.microsoftonline.com/4746e69d-f66c-4396-847a-5ad46b58402f',
      // The ONLY redirect URI that needs registering in Azure AD —
      // every protected page routes its login round-trip through
      // this one page (see the "return to originating page" logic
      // below and in the index.html init hook).
      redirectUri: window.location.origin + '/index.html',
    },
    cache: {
      cacheLocation: 'sessionStorage',
      storeAuthStateInCookie: false,
    },
  };

  var loginRequest = { scopes: ['User.Read'] };

  // Where to send an unauthenticated visitor back to after login
  // completes — read once by index.html's init hook.
  var RETURN_TO_KEY = 'budgetAppAuthReturnTo';

  // TEMPORARY KILL SWITCH — set to true to re-enable sign-in. While
  // false, no Microsoft login happens, pages load immediately, and
  // requests go out with an empty access token. The Apps Script
  // backend has its own matching switch (AUTH_REQUIRED in
  // docs/apps-script/CapitalProjectsCode.gs) that must be flipped too.
  var AUTH_ENABLED = false;

  var msalInstance = AUTH_ENABLED ? new msal.PublicClientApplication(msalConfig) : null;
  var currentAccount = null;

  // Resolved once by init() below; every page's other scripts can
  // `await window.BudgetApp.Auth.ready` before doing anything that
  // needs to know whether a visitor is signed in.
  var readyResolve;
  var ready = new Promise(function (resolve) { readyResolve = resolve; });

  function isSignedIn() {
    return !!currentAccount;
  }

  function getAccount() {
    return currentAccount;
  }

  function signOut() {
    msalInstance.logoutRedirect({ account: currentAccount });
  }

  // Populates an optional #authUserInfo element (if the page has
  // one) with "Signed in as <name> · Sign out" — one line of markup
  // per page (an empty <span id="authUserInfo">) is all a page needs
  // to opt into this instead of building its own version.
  function renderUserInfo() {
    var container = document.getElementById('authUserInfo');
    if (!container || !currentAccount) return;

    container.innerHTML = '';
    var label = document.createElement('span');
    label.textContent = 'Signed in as ' + (currentAccount.name || currentAccount.username);
    var signOutLink = document.createElement('a');
    signOutLink.href = '#';
    signOutLink.textContent = 'Sign out';
    signOutLink.style.marginLeft = '10px';
    signOutLink.addEventListener('click', function (e) {
      e.preventDefault();
      signOut();
    });

    container.appendChild(label);
    container.appendChild(signOutLink);
  }

  // Silently exchanges the cached session for a fresh Graph access
  // token — MSAL handles refresh under the hood. Falls back to a
  // full redirect login only if silent acquisition genuinely fails
  // (e.g. the session was revoked), which is the same "not signed
  // in after all" path init() uses.
  function getAccessToken() {
    if (!AUTH_ENABLED) return Promise.resolve('');
    if (!currentAccount) {
      return Promise.reject(new Error('Not signed in.'));
    }
    return msalInstance.acquireTokenSilent(Object.assign({ account: currentAccount }, loginRequest))
      .then(function (result) { return result.accessToken; })
      .catch(function () {
        redirectToLogin();
        // redirectToLogin() navigates away; this rejection is only
        // ever seen by a caller that somehow runs before the browser
        // finishes navigating.
        return Promise.reject(new Error('Session expired — redirecting to sign in.'));
      });
  }

  function redirectToLogin() {
    try {
      sessionStorage.setItem(RETURN_TO_KEY, window.location.href);
    } catch (err) {
      // Storage unavailable — login will just land on index.html
      // instead of bouncing back to the originating page.
    }
    msalInstance.loginRedirect(loginRequest);
  }

  // True only on index.html itself — the one page every login
  // round-trip returns to (see msalConfig.auth.redirectUri above).
  // Used to decide whether this page load's job is "show its own
  // content" or "forward the browser to whatever page actually
  // redirected here".
  function isRedirectUriPage() {
    return window.location.href.split('?')[0].split('#')[0] === msalConfig.auth.redirectUri;
  }

  // If a session just got established (existing or freshly
  // completed) while sitting on the shared redirect-URI page, and
  // some other page is the one that actually sent the visitor to
  // login, forward the browser there now instead of rendering
  // index.html's own content. Returns true if a forward is in
  // flight (caller should do nothing further this page load).
  function forwardToReturnUrlIfNeeded() {
    if (!isRedirectUriPage()) return false;
    var returnTo;
    try {
      returnTo = sessionStorage.getItem(RETURN_TO_KEY);
    } catch (err) {
      return false;
    }
    if (!returnTo || returnTo === window.location.href) return false;
    sessionStorage.removeItem(RETURN_TO_KEY);
    window.location.href = returnTo;
    return true;
  }

  // Runs once per page load. Order matters: handleRedirectPromise()
  // MUST be called (and awaited) before getAllAccounts(), since it's
  // what completes the login MSAL just redirected back from.
  function init() {
    msalInstance.initialize()
      .then(function () { return msalInstance.handleRedirectPromise(); })
      .then(function (redirectResult) {
        if (redirectResult && redirectResult.account) {
          currentAccount = redirectResult.account;
          msalInstance.setActiveAccount(currentAccount);
        } else {
          var existing = msalInstance.getAllAccounts();
          if (existing.length > 0) {
            currentAccount = existing[0];
            msalInstance.setActiveAccount(currentAccount);
          }
        }

        if (!currentAccount) {
          redirectToLogin(); // navigates away — nothing after this on this page load matters
          return;
        }

        if (forwardToReturnUrlIfNeeded()) return; // navigating away to the originating page

        renderUserInfo();
        readyResolve();
      })
      .catch(function (err) {
        console.error('[auth] Initialization failed:', err);
        redirectToLogin();
      });
  }

  if (AUTH_ENABLED) {
    init();
  } else {
    readyResolve();
  }

  return {
    ready: ready,
    isSignedIn: isSignedIn,
    getAccount: getAccount,
    getAccessToken: getAccessToken,
    signOut: signOut,
  };
})();
