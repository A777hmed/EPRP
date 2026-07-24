/* EPROM Weekly/Monthly Reports — Firebase live sync adapter
 * Inert until CONFIG is filled. Zero changes needed in the report pages:
 * it mirrors every `eprom.*` localStorage key to Firestore and replays
 * remote changes as `storage` events, which the reports already listen to.
 *
 * ENABLE: Firebase console → Project settings → Your apps → SDK config,
 * paste the object below, then set var CONFIG = { ... }.
 */
(function () {
  var CONFIG = null; // ← paste firebaseConfig here, e.g.:
  // var CONFIG = { apiKey: "AIza…", authDomain: "eprom-reports.firebaseapp.com", projectId: "eprom-reports" };
  if (!CONFIG || !CONFIG.projectId) return; // stays inert until configured

  var PREFIX = 'eprom.', COL = 'eprom-reports';
  var idOf = function (k) { return k.split('.').join('~'); };
  var keyOf = function (id) { return id.split('~').join('.'); };
  var applying = false, timers = {}, db = null;
  var rawSet = localStorage.setItem.bind(localStorage);

  // outbound: local edit → debounced Firestore write (last-write-wins)
  localStorage.setItem = function (k, v) {
    rawSet(k, v);
    if (applying || String(k).indexOf(PREFIX) !== 0) return;
    clearTimeout(timers[k]);
    timers[k] = setTimeout(function () {
      if (db) db.collection(COL).doc(idOf(k)).set({ v: v, updatedAt: Date.now(), by: navigator.userAgent.slice(0, 40), locked: v.indexOf('"stage":2') >= 0 });
    }, 400);
  };

  // load Firebase compat SDK, then subscribe
  var srcs = [
    'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js',
    'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js'
  ];
  var i = 0;
  (function next() {
    if (i >= srcs.length) return start();
    var el = document.createElement('script');
    el.src = srcs[i++]; el.onload = next;
    document.head.appendChild(el);
  })();

  function start() {
    firebase.initializeApp(CONFIG);
    var auth = firebase.auth();
    // arriving via the emailed link? finish the sign-in
    if (auth.isSignInWithEmailLink(window.location.href)) {
      var email = localStorage.getItem('epromFbEmail') || window.prompt('Confirm your email to finish sign-in');
      auth.signInWithEmailLink(email || '', window.location.href).then(function () {
        try { history.replaceState(null, '', location.pathname); } catch (e) {}
      }).catch(function (e) { console.warn('firebase-sync: email-link sign-in failed', e); });
    }
    auth.onAuthStateChanged(function (user) {
      if (user) {
        hideBar();
        rawSet('epromFbUid', user.uid); // display-only; NOT synced (no eprom. prefix)
        console.info('firebase-sync: signed in as ' + (user.email || '?') + ' — UID (add to /admins for admin rights): ' + user.uid);
        if (!db) subscribe();
        checkRole(user);
      } else { hideBadge(); showBar(auth); }
    });
  }

  // role badge — read-only (not in /editors) or admin (in /admins)
  var badge = null;
  function hideBadge() { if (badge && badge.parentNode) badge.parentNode.removeChild(badge); badge = null; }
  function showBadge(html, bg, border, color, title) {
    hideBadge();
    badge = document.createElement('div');
    badge.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:9998;background:' + bg + ';border:1.5px solid ' + border + ';color:' + color + ';font:12px Barlow,sans-serif;font-weight:700;padding:7px 13px;border-radius:16px;box-shadow:0 3px 12px rgba(10,44,92,.18);cursor:default';
    badge.innerHTML = html;
    badge.title = title || '';
    if (document.body) document.body.appendChild(badge);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(badge); });
  }
  function checkRole(user) {
    if (!db) db = firebase.firestore();
    Promise.all([
      db.collection('editors').doc(user.uid).get().catch(function () { return { exists: false }; }),
      db.collection('admins').doc(user.uid).get().catch(function () { return { exists: false }; })
    ]).then(function (r) {
      var isEditor = r[0].exists, isAdmin = r[1].exists;
      if (isAdmin) showBadge('\u2605 Admin', '#E7F3E7', '#3FA535', '#2E7D32', 'Full access — can approve, lock, and edit locked reports');
      else if (isEditor) hideBadge();
      else showBadge('\uD83D\uDD12 Read-only \u2014 viewing live, edits stay on this device', '#FBF1DE', '#E8A13A', '#8A6A12', 'Your UID is not in the editors whitelist. Ask the admin to add it: ' + user.uid);
    });
  }

  // slim sign-in bar shown only while signed out
  var bar = null;
  function hideBar() { if (bar && bar.parentNode) bar.parentNode.removeChild(bar); bar = null; }
  function showBar(auth) {
    if (bar) return;
    bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#0D3B7C;color:#fff;font:13px Barlow,sans-serif;display:flex;gap:10px;align-items:center;justify-content:center;padding:10px;box-shadow:0 -2px 10px rgba(10,44,92,.3)';
    var lbl = document.createElement('b'); lbl.textContent = 'Live sync — sign in:';
    var inp = document.createElement('input');
    inp.type = 'email'; inp.placeholder = 'work email';
    inp.style.cssText = 'padding:6px 10px;border-radius:5px;border:none;width:220px;font:13px Barlow,sans-serif';
    inp.value = localStorage.getItem('epromFbEmail') || '';
    var btn = document.createElement('button');
    btn.textContent = 'Send sign-in link';
    btn.style.cssText = 'padding:6px 12px;border-radius:5px;border:none;background:#3FA535;color:#fff;font-weight:700;cursor:pointer;font:13px Barlow,sans-serif';
    btn.onclick = function () {
      var em = inp.value.trim(); if (!em) return;
      rawSet('epromFbEmail', em);
      auth.sendSignInLinkToEmail(em, { url: window.location.href, handleCodeInApp: true }).then(function () {
        bar.textContent = '✓ Link sent to ' + em + ' — open it on this device to finish sign-in.';
      }).catch(function (e) { bar.textContent = 'Could not send link: ' + e.message; });
    };
    bar.appendChild(lbl); bar.appendChild(inp); bar.appendChild(btn);
    if (document.body) document.body.appendChild(bar);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(bar); });
  }

  function subscribe() {
    db = firebase.firestore();
    // inbound: Firestore change → localStorage + synthetic storage event
    db.collection(COL).onSnapshot(function (snap) {
      snap.docChanges().forEach(function (ch) {
        if (ch.type === 'removed') return;
        var k = keyOf(ch.doc.id), v = (ch.doc.data() || {}).v;
        if (typeof v !== 'string' || localStorage.getItem(k) === v) return;
        applying = true; rawSet(k, v); applying = false;
        try { window.dispatchEvent(new StorageEvent('storage', { key: k, newValue: v })); } catch (e) {}
      });
    });
  }
})();
