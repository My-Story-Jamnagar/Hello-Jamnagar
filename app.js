/* =====================================================================
   PushUP — public frontend logic
   Depends on: config.js (window.PUSHUP_CONFIG), OneSignal v16 page SDK
   All Supabase calls use the anon key + PostgREST / RPC only.
   ===================================================================== */
(function () {
  'use strict';

  var CFG = window.PUSHUP_CONFIG;

  /* ---------- 1. All user-facing strings in one place (fix #15) ------- */
  var STRINGS = {
    subOn:         'સૂચનાઓ ચાલુ છે ✓',
    subOff:        'સૂચનાઓ ચાલુ કરો',
    subWorking:    'થોભો…',
    stateOn:       'તમે સૂચનાઓ મેળવી રહ્યા છો.',
    stateOff:      'સૂચનાઓ બંધ છે.',
    stateBlocked:  'બ્રાઉઝરે સૂચનાઓ બ્લોક કરી છે.',
    stateUnsup:    'આ બ્રાઉઝર પુશ સૂચના સપોર્ટ કરતું નથી.',
    thanksSub:     'ધન્યવાદ! સૂચનાઓ ચાલુ થઈ ગઈ.',
    errGeneric:    'કંઈક ખોટું થયું. ફરી પ્રયાસ કરો.',
    errNetwork:    'નેટવર્ક સમસ્યા.',
    loadMoreFail:  'વધુ લોડ થઈ શક્યું નહીં.',
    nameReq:       'નામ જરૂરી છે.',
    mobileReq:     'મોબાઇલ નંબર 10 અંકનો હોવો જોઈએ.',
    emailReq:      'માન્ય ઈ-મેલ લખો.',
    msgReq:        'સંદેશ જરૂરી છે.',
    captchaReq:    'ચકાસણીનો જવાબ લખો.',
    sending:       'મોકલાય છે…',
    sent:          'તમારો સંદેશ મળી ગયો. ધન્યવાદ!',
    captchaFail:   'ચકાસણીનો જવાબ ખોટો છે.',
    captchaLoad:   'લોડ થાય છે…',
    captchaErr:    'ચકાસણી લોડ થઈ નહીં.',
    liked:         'પસંદ',
    disliked:      'નાપસંદ',
    openLink:      'લિંક ખોલો',
    starred:       'પિન કરેલા'
  };

  /* ---------- 2. Tiny helpers ---------------------------------------- */
  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(text) {
    var t = $('#toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 3200);
  }

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleString('gu-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (e) { return ''; }
  }

  /* ---------- 3. Supabase REST wrapper ------------------------------- */
  var SB_HEADERS = {
    'apikey': CFG.SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + CFG.SUPABASE_ANON_KEY,
    'Content-Type': 'application/json'
  };

  function sbGet(path, extraHeaders) {
    var h = Object.assign({}, SB_HEADERS, extraHeaders || {});
    return fetch(CFG.SUPABASE_URL + '/rest/v1/' + path, { headers: h })
      .then(function (r) {
        if (!r.ok) throw new Error('GET ' + path + ' → ' + r.status);
        return r.json();
      });
  }

  function sbRpc(fn, body) {
    return fetch(CFG.SUPABASE_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST', headers: SB_HEADERS, body: JSON.stringify(body || {})
    }).then(function (r) {
      if (!r.ok) throw new Error('RPC ' + fn + ' → ' + r.status);
      return r.status === 204 ? null : r.json();
    });
  }

  /* ---------- 4. Fingerprint (soft protection only) ------------------
     NOTE: a localStorage fingerprint is soft protection. A determined
     user can clear it and vote again. Real rate limiting needs a
     server-side Edge Function / IP throttle — out of scope at zero cost.
  -------------------------------------------------------------------- */
  function getFingerprint() {
    var k = 'pushup_fp';
    var v = '';
    try { v = localStorage.getItem(k) || ''; } catch (e) {}
    if (v && v.length >= 16) return v;

    var raw = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : ('fp-' + Date.now().toString(36) + Math.random().toString(36).slice(2) +
         Math.random().toString(36).slice(2));
    v = raw.replace(/-/g, '').slice(0, 32);            // 32 chars → passes 16..64 check
    try { localStorage.setItem(k, v); } catch (e) {}
    return v;
  }
  var FP = getFingerprint();

  /* ---------- 5. Local vote cache (for instant button state) --------- */
  function myVotes() {
    try { return JSON.parse(localStorage.getItem('pushup_votes') || '{}'); }
    catch (e) { return {}; }
  }
  function setMyVote(id, type) {
    var v = myVotes();
    if (type) v[id] = type; else delete v[id];
    try { localStorage.setItem('pushup_votes', JSON.stringify(v)); } catch (e) {}
  }

  /* =====================================================================
     6. VIEW TRACKING — batched + deduped (fix #6)
     - Each message counted once per session on the client.
     - Server also dedupes per fingerprint/message/day (uq_pushup_ma_dedupe).
     - Max 50 ids per RPC call (server guard).
     ===================================================================== */
  var viewQueue = [];
  var viewTimer = null;

  function sessionSeen() {
    try { return JSON.parse(sessionStorage.getItem('pushup_viewed') || '[]'); }
    catch (e) { return []; }
  }
  function markSessionSeen(ids) {
    var all = sessionSeen().concat(ids);
    try { sessionStorage.setItem('pushup_viewed', JSON.stringify(all.slice(-500))); } catch (e) {}
  }

  function queueView(id) {
    if (sessionSeen().indexOf(id) !== -1) return;
    if (viewQueue.indexOf(id) !== -1) return;
    viewQueue.push(id);
    clearTimeout(viewTimer);
    viewTimer = setTimeout(flushViews, 1200);          // batch window
  }

  function flushViews() {
    if (!viewQueue.length) return;
    var batch = viewQueue.splice(0, 50);
    markSessionSeen(batch);
    sbRpc(CFG.RPC_RECORD_VIEWS, { p_message_ids: batch, p_fingerprint: FP })
      .catch(function (e) { console.warn('views', e); });
    if (viewQueue.length) viewTimer = setTimeout(flushViews, 1200);
  }
  window.addEventListener('pagehide', flushViews);

  /* =====================================================================
     7. FEEDBACK COUNTS
     ===================================================================== */
  function fetchCounts(ids) {
    if (!ids.length) return Promise.resolve({});
    var inList = 'in.(' + ids.join(',') + ')';
    return sbGet(CFG.VIEW_FEEDBACK_COUNTS + '?select=message_id,likes,dislikes&message_id=' + inList)
      .then(function (rows) {
        var map = {};
        rows.forEach(function (r) { map[r.message_id] = r; });
        return map;
      })
      .catch(function () { return {}; });
  }

  function paintCounts(map) {
    Object.keys(map).forEach(function (id) {
      var card = document.querySelector('[data-mid="' + id + '"]');
      if (!card) return;
      var l = $('.like-n', card), d = $('.dis-n', card);
      if (l) l.textContent = map[id].likes || 0;
      if (d) d.textContent = map[id].dislikes || 0;
    });
  }

  /* Optimistic like/dislike with rollback (§8.5) */
  function onVote(card, type) {
    var id   = card.getAttribute('data-mid');
    var lEl  = $('.like-n', card), dEl = $('.dis-n', card);
    var prevL = parseInt(lEl.textContent, 10) || 0;
    var prevD = parseInt(dEl.textContent, 10) || 0;
    var prevVote = myVotes()[id] || null;

    // ---- optimistic ----
    var nl = prevL, nd = prevD, nv;
    if (prevVote === type) {                       // toggle off
      nv = null;
      if (type === 'like') nl = Math.max(0, nl - 1); else nd = Math.max(0, nd - 1);
    } else {
      nv = type;
      if (type === 'like') { nl++; if (prevVote === 'dislike') nd = Math.max(0, nd - 1); }
      else                 { nd++; if (prevVote === 'like')    nl = Math.max(0, nl - 1); }
    }
    lEl.textContent = nl; dEl.textContent = nd;
    setMyVote(id, nv); paintVoteState(card);

    sbRpc(CFG.RPC_SUBMIT_FEEDBACK, {
      p_message_id: id, p_fingerprint: FP, p_type: type
    }).then(function (rows) {
      var r = Array.isArray(rows) ? rows[0] : rows;
      if (!r) return;
      lEl.textContent = r.likes || 0;
      dEl.textContent = r.dislikes || 0;
      setMyVote(id, r.my_vote || null);
      paintVoteState(card);
    }).catch(function () {                          // ---- rollback ----
      lEl.textContent = prevL; dEl.textContent = prevD;
      setMyVote(id, prevVote); paintVoteState(card);
      toast(STRINGS.errGeneric);
    });
  }

  function paintVoteState(card) {
    var v = myVotes()[card.getAttribute('data-mid')] || null;
    $('.btn-like', card).classList.toggle('is-on', v === 'like');
    $('.btn-dis',  card).classList.toggle('is-on', v === 'dislike');
  }

  /* =====================================================================
     8. CARD RENDERING
     ===================================================================== */
  function cardHtml(m) {
    var link = m.redirect_url
      ? '<a class="card-link" href="go.html?id=' + esc(m.id) + '" rel="noopener">' +
        STRINGS.openLink + ' →</a>'
      : '';
    return '' +
      '<article class="card' + (m.is_starred ? ' card-star' : '') + '" data-mid="' + esc(m.id) + '">' +
        '<div class="card-head">' +
          (m.is_starred ? '<span class="star" title="' + STRINGS.starred + '">⭐</span>' : '') +
          '<h3 class="card-title">' + esc(m.title) + '</h3>' +
        '</div>' +
        '<p class="card-body">' + esc(m.body).replace(/\n/g, '<br>') + '</p>' +
        '<div class="card-meta">' +
          '<span class="chip">' + esc(m.group_name) + '</span>' +
          '<time>' + esc(fmtDate(m.created_at)) + '</time>' +
        '</div>' +
        link +
        '<div class="card-actions">' +
          '<button class="btn-fb btn-like" type="button" aria-label="' + STRINGS.liked + '">' +
            '👍 <span class="like-n">0</span></button>' +
          '<button class="btn-fb btn-dis" type="button" aria-label="' + STRINGS.disliked + '">' +
            '👎 <span class="dis-n">0</span></button>' +
        '</div>' +
      '</article>';
  }

  function mountCards(container, rows, append) {
    var html = rows.map(cardHtml).join('');
    if (append) container.insertAdjacentHTML('beforeend', html);
    else container.innerHTML = html;

    rows.forEach(function (m) {
      var card = container.querySelector('[data-mid="' + m.id + '"]');
      if (!card) return;
      paintVoteState(card);
      $('.btn-like', card).addEventListener('click', function () { onVote(card, 'like'); });
      $('.btn-dis',  card).addEventListener('click', function () { onVote(card, 'dislike'); });
      viewObserver.observe(card);                   // count view when actually seen
    });

    fetchCounts(rows.map(function (r) { return r.id; })).then(paintCounts);
  }

  /* Count a view only when the card is genuinely on screen */
  var viewObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) {
        queueView(en.target.getAttribute('data-mid'));
        viewObserver.unobserve(en.target);
      }
    });
  }, { threshold: 0.5 });

  /* =====================================================================
     9. FEED (pagination + search + starred de-dup)
     ===================================================================== */
  var SEL = 'id,title,body,group_name,is_starred,redirect_url,created_at';
  var feed = { page: 0, loading: false, done: false, q: '', starredIds: [] };

  function liveFilter() {
    // RLS already hides inactive/expired/deleted rows; this keeps the
    // intent explicit and lets PostgREST use the partial index.
    return '&or=(expire_at.is.null,expire_at.gt.' + new Date().toISOString() + ')';
  }

  function loadStarred() {
    if (feed.q) { $('#starred-section').hidden = true; feed.starredIds = []; return Promise.resolve(); }
    return sbGet(CFG.TBL_MESSAGES + '?select=' + SEL +
                 '&is_starred=is.true&order=created_at.desc&limit=10' + liveFilter())
      .then(function (rows) {
        feed.starredIds = rows.map(function (r) { return r.id; });
        $('#starred-section').hidden = rows.length === 0;
        if (rows.length) mountCards($('#starred-list'), rows, false);
      })
      .catch(function () { $('#starred-section').hidden = true; });
  }

  function loadFeed(reset) {
    if (feed.loading) return;
    if (reset) { feed.page = 0; feed.done = false; $('#feed-list').innerHTML = ''; }
    if (feed.done) return;

    feed.loading = true;
    $('#feed-error').hidden = true;
    $('#feed-empty').hidden = true;
    $('#feed-end').hidden   = true;
    $('#feed-skeleton').hidden = false;

    var from = feed.page * CFG.PAGE_SIZE;
    var to   = from + CFG.PAGE_SIZE - 1;

    var url = CFG.TBL_MESSAGES + '?select=' + SEL +
              '&order=is_starred.desc,created_at.desc' + liveFilter();

    if (feed.q) {
      var q = encodeURIComponent('*' + feed.q.replace(/[(),*]/g, ' ') + '*');
      url += '&or=(title.ilike.' + q + ',body.ilike.' + q + ')';
    } else if (feed.starredIds.length) {
      // de-duplicate: starred cards already shown in the pinned section (§8.4)
      url += '&id=not.in.(' + feed.starredIds.join(',') + ')';
    }

    sbGet(url, { 'Range-Unit': 'items', 'Range': from + '-' + to })
      .then(function (rows) {
        $('#feed-skeleton').hidden = true;
        feed.loading = false;

        if (!rows.length && feed.page === 0) {
          $('#feed-empty').hidden = false;
          feed.done = true;
          return;
        }
        mountCards($('#feed-list'), rows, feed.page > 0);
        feed.page += 1;
        if (rows.length < CFG.PAGE_SIZE) {
          feed.done = true;
          $('#feed-end').hidden = false;
        }
      })
      .catch(function (e) {
        console.warn(e);
        $('#feed-skeleton').hidden = true;
        feed.loading = false;
        if (feed.page === 0) $('#feed-error').hidden = false;
        else toast(STRINGS.loadMoreFail);
      });
  }

  new IntersectionObserver(function (entries) {
    if (entries[0].isIntersecting) loadFeed(false);
  }, { rootMargin: '400px' }).observe($('#sentinel'));

  $('#feed-retry').addEventListener('click', function () { loadFeed(true); });

  /* Search with 400 ms debounce */
  var sTimer = null;
  $('#search').addEventListener('input', function (e) {
    var val = e.target.value.trim();
    $('#search-clear').hidden = val.length === 0;
    clearTimeout(sTimer);
    sTimer = setTimeout(function () {
      feed.q = val;
      $('#feed-heading').textContent = val ? 'શોધ પરિણામ' : 'તાજા સમાચાર';
      loadStarred().then(function () { loadFeed(true); });
    }, CFG.SEARCH_DEBOUNCE_MS);
  });
  $('#search-clear').addEventListener('click', function () {
    $('#search').value = ''; $('#search-clear').hidden = true;
    feed.q = ''; $('#feed-heading').textContent = 'તાજા સમાચાર';
    loadStarred().then(function () { loadFeed(true); });
  });

  /* =====================================================================
     10. EVENTS (§8.6)
     ===================================================================== */
  function loadEvents() {
    sbGet(CFG.TBL_EVENTS +
          '?select=id,title,subtitle,description,display_order' +
          '&order=display_order.asc,created_at.desc&limit=20')
      .then(function (rows) {
        if (!rows.length) { $('#events-section').hidden = true; return; }
        $('#events-list').innerHTML = rows.map(function (ev) {
          return '<div class="event">' +
            '<h3>' + esc(ev.title) + '</h3>' +
            (ev.subtitle ? '<p class="event-sub">' + esc(ev.subtitle) + '</p>' : '') +
            (ev.description ? '<p>' + esc(ev.description).replace(/\n/g, '<br>') + '</p>' : '') +
          '</div>';
        }).join('');
        $('#events-section').hidden = false;
      })
      .catch(function () { $('#events-section').hidden = true; });
  }

  /* =====================================================================
     11. MEDIA (§8.7)
     ===================================================================== */
  var photoPage = 0;

  function loadVideos() {
    sbGet(CFG.TBL_VIDEOS + '?select=id,title,url&order=created_at.desc&limit=50')
      .then(function (rows) {
        $('#videos-empty').hidden = rows.length > 0;
        $('#videos-list').innerHTML = rows.map(function (v) {
          return '<li><a href="' + esc(v.url) + '" target="_blank" rel="noopener noreferrer">▶ ' +
                 esc(v.title) + '</a></li>';
        }).join('');
      })
      .catch(function () { $('#videos-empty').hidden = false; });
  }

  function loadPhotos() {
    var from = photoPage * CFG.PHOTO_PAGE_SIZE;
    var to   = from + CFG.PHOTO_PAGE_SIZE - 1;
    sbGet(CFG.TBL_PHOTOS + '?select=id,title,storage_url&order=created_at.desc',
          { 'Range-Unit': 'items', 'Range': from + '-' + to })
      .then(function (rows) {
        if (!rows.length && photoPage === 0) { $('#photos-empty').hidden = false; return; }
        $('#photos-empty').hidden = true;
        $('#photos-grid').insertAdjacentHTML('beforeend', rows.map(function (p) {
          return '<a class="photo" href="' + esc(p.storage_url) +
                 '" target="_blank" rel="noopener noreferrer">' +
                 '<img src="' + esc(p.storage_url) + '" alt="' + esc(p.title || '') +
                 '" loading="lazy" decoding="async" /></a>';
        }).join(''));
        photoPage += 1;
        $('#photos-more').hidden = rows.length < CFG.PHOTO_PAGE_SIZE;
      })
      .catch(function () { $('#photos-empty').hidden = false; });
  }
  $('#photos-more').addEventListener('click', loadPhotos);

  /* =====================================================================
     12. TABS
     ===================================================================== */
  var mediaLoaded = false, captchaLoaded = false;
  $$('.tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var name = btn.getAttribute('data-tab');
      $$('.tab').forEach(function (b) {
        var on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      $$('.tabpanel').forEach(function (p) { p.hidden = true; });
      $('#tab-' + name).hidden = false;

      if (name === 'media' && !mediaLoaded) { mediaLoaded = true; loadVideos(); loadPhotos(); }
      if (name === 'contact' && !captchaLoaded) { captchaLoaded = true; loadCaptcha(); }
    });
  });

  /* =====================================================================
     13. CONTACT FORM (§8.8) — CAPTCHA answer verified only in GAS
     ===================================================================== */
  var captchaToken = '';

  function loadCaptcha() {
    $('#captcha-q').textContent = STRINGS.captchaLoad;
    fetch(CFG.GAS_WEBAPP_URL + '?action=captcha')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        captchaToken = d.token || '';
        $('#captcha-q').textContent = d.question || '?';
      })
      .catch(function () { $('#captcha-q').textContent = STRINGS.captchaErr; });
  }
  $('#captcha-refresh').addEventListener('click', loadCaptcha);

  // fix #17 — tolerate +91, spaces, dashes before checking 10 digits
  function normaliseMobile(raw) {
    var d = String(raw || '').replace(/[\s\-().]/g, '');
    d = d.replace(/^\+?91/, '').replace(/^0+/, '');
    return d;
  }

  $('#contact-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var out = $('#contact-msg');
    var show = function (txt, bad) {
      out.textContent = txt;
      out.hidden = false;
      out.classList.toggle('state-err', !!bad);
    };

    var name   = $('#c-name').value.trim();
    var mobile = normaliseMobile($('#c-mobile').value);
    var email  = $('#c-email').value.trim();
    var body   = $('#c-message').value.trim();
    var answer = $('#c-captcha').value.trim();

    if (!name)                      return show(STRINGS.nameReq, true);
    if (!/^[0-9]{10}$/.test(mobile))return show(STRINGS.mobileReq, true);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return show(STRINGS.emailReq, true);
    if (!body)                      return show(STRINGS.msgReq, true);
    if (!answer)                    return show(STRINGS.captchaReq, true);

    var btn = $('#contact-submit');
    btn.disabled = true;
    show(STRINGS.sending, false);

    // text/plain avoids a CORS preflight that GAS web apps cannot answer
    fetch(CFG.GAS_WEBAPP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'contact',
        name: name, mobile: mobile, email: email,
        message: body, captcha: answer, token: captchaToken
      })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        btn.disabled = false;
        if (d && d.ok) {
          show(STRINGS.sent, false);
          $('#contact-form').reset();
          loadCaptcha();
        } else {
          show((d && d.message) || STRINGS.captchaFail, true);
          loadCaptcha();
        }
      })
      .catch(function () {
        btn.disabled = false;
        show(STRINGS.errNetwork, true);
      });
  });

  /* =====================================================================
     14. ONESIGNAL v16 (§8.2)
     - Root domain → serviceWorkerParam scope "/"
     - Custom prompt only, after a user gesture
     - Subscription ID persisted via pushup_upsert_subscription RPC
     ===================================================================== */
  var OS = null, osReady = false, subscribing = false;

  function setSubUi(state) {
    var btn = $('#btn-subscribe'), lbl = $('#sub-label'), st = $('#sub-state');
    if (state === 'on') {
      lbl.textContent = STRINGS.subOn; btn.disabled = true;
      btn.classList.add('is-on'); st.textContent = STRINGS.stateOn;
      $('#blocked-banner').hidden = true;
    } else if (state === 'blocked') {
      lbl.textContent = STRINGS.subOff; btn.disabled = true;
      st.textContent = STRINGS.stateBlocked;
      $('#blocked-banner').hidden = false;
    } else if (state === 'unsupported') {
      lbl.textContent = STRINGS.subOff; btn.disabled = true;
      st.textContent = STRINGS.stateUnsup;
    } else {
      lbl.textContent = STRINGS.subOff; btn.disabled = false;
      btn.classList.remove('is-on'); st.textContent = STRINGS.stateOff;
      $('#blocked-banner').hidden = true;
    }
  }

  function persistSubscription() {
    try {
      var sid = OS && OS.User && OS.User.PushSubscription && OS.User.PushSubscription.id;
      if (!sid) return;
      var last = '';
      try { last = localStorage.getItem('pushup_sid') || ''; } catch (e) {}
      if (last === sid) return;                       // avoid needless writes
      sbRpc(CFG.RPC_UPSERT_SUB, {
        p_subscription_id: sid, p_group_name: CFG.DEFAULT_GROUP
      }).then(function () {
        try { localStorage.setItem('pushup_sid', sid); } catch (e) {}
      }).catch(function (e) { console.warn('sub persist', e); });
    } catch (e) { console.warn(e); }
  }

    function refreshSubState(event) {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      setSubUi('unsupported'); return;
    }
    if (Notification.permission === 'denied') { setSubUi('blocked'); return; }

    var opted = (event && event.current && typeof event.current.optedIn === 'boolean')
      ? event.current.optedIn
      : !!(OS && OS.User && OS.User.PushSubscription && OS.User.PushSubscription.optedIn === true);

    if (subscribing && opted === false) return;   // વચગાળાની સ્થિતિ અવગણો

    if (opted) { setSubUi('on'); persistSubscription(); }
    else { setSubUi('off'); }
  }

  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async function (OneSignal) {
    OS = OneSignal;
    try {
      await OneSignal.init({
        appId: CFG.ONESIGNAL_APP_ID,
        serviceWorkerPath: "/Hello-Jamnagar/OneSignalSDKWorker.js",
        serviceWorkerParam: { scope: "/Hello-Jamnagar/" },
        allowLocalhostAsSecureOrigin: true,
        autoResubscribe: true,
        // custom UI only — never the SDK's own slide prompt
        promptOptions: { slidedown: { enabled: false } }
      });
osReady = true;
      // tag used by the admin panel's `filters` targeting (§7.3)
      try { await OneSignal.User.addTag('group', CFG.DEFAULT_GROUP); } catch (e) {}

      OneSignal.User.PushSubscription.addEventListener('change', refreshSubState);
      refreshSubState();

      /* autoResubscribe/restore થોડા સમયમાં આવે છે — ફરીથી તપાસો */
      [400, 1200, 3000, 6000].forEach(function (ms) {
        setTimeout(function () {
          if (!subscribing) refreshSubState();
        }, ms);
      });
    } catch (e) {
      console.warn('OneSignal init', e);
      setSubUi('off');
    }
  });

  /* Custom prompt flow — permission requested only on a real tap */
  $('#btn-subscribe').addEventListener('click', function () {
    if (Notification.permission === 'denied') { setSubUi('blocked'); return; }
    $('#prompt-modal').hidden = false;
  });
  $('#pm-no').addEventListener('click', function () { $('#prompt-modal').hidden = true; });
  $('#pm-yes').addEventListener('click', async function () {
  $('#prompt-modal').hidden = true;

  if (!osReady) {
    $('#sub-label').textContent = STRINGS.subWorking;
    try {
      await new Promise(function (resolve, reject) {
        var waited = 0;
        (function check() {
          if (osReady) return resolve();
          waited += 200;
          if (waited >= 10000) return reject(new Error('OneSignal timeout'));
          setTimeout(check, 200);
        })();
      });
    } catch (e) {
      setSubUi('off'); toast(STRINGS.errGeneric); return;
    }
  }

  $('#sub-label').textContent = STRINGS.subWorking;
  subscribing = true;
  try {
        /* optIn() જાતે native permission prompt બતાવે છે — ટેપના gesture માં જ રહેવું જોઈએ */
    try {
      await OS.User.PushSubscription.optIn();
    } catch (e) {
      console.warn('optIn', e);
      var optMsg = e && e.message ? e.message : String(e);
      setSubUi('off');
      $('#sub-state').textContent = 'optIn error: ' + optMsg;
      toast('optIn error: ' + optMsg);
      return;
    }

    if (Notification.permission !== 'granted') {
      setSubUi(Notification.permission === 'denied' ? 'blocked' : 'off');
      return;
    }

    var ok = false;
    for (var i = 0; i < 40; i++) {
      var ps = OS.User && OS.User.PushSubscription;
      if (ps && ps.optedIn === true && ps.id) { ok = true; break; }
      await new Promise(function (r) { setTimeout(r, 250); });
    }

        if (!ok) {
      var ps2 = OS.User && OS.User.PushSubscription;
      var regs = 'n/a';
      try {
        regs = (await navigator.serviceWorker.getRegistrations())
          .map(function (r) { return r.scope; }).join(' | ') || 'none';
      } catch (e) { regs = 'error'; }
      var diag = 'permission=' + Notification.permission +
                 ', optedIn=' + (ps2 && ps2.optedIn) +
                 ', id=' + (ps2 && ps2.id ? 'yes' : 'no') +
                 ', token=' + (ps2 && ps2.token ? 'yes' : 'no') +
                 ', sw=' + regs;
      console.warn('subscribe diag', diag);
                 alert('DIAG: ' + diag);
      setSubUi('off');
      $('#sub-state').textContent = 'Subscription ના બન્યું: ' + diag;
      toast('Subscription ના બન્યું: ' + diag);
      return;
    }
    try { await OS.User.addTag('group', CFG.DEFAULT_GROUP); } catch (e) {}
    setSubUi('on');
    persistSubscription();
    toast(STRINGS.thanksSub);
    } catch (e) {
    console.warn(e);
    var errMsg = e && e.message ? e.message : String(e);
    setSubUi('off');
    $('#sub-state').textContent = 'Error: ' + errMsg;
    toast('Error: ' + errMsg);
  } finally {
    subscribing = false;
  }
});

  /* =====================================================================
     15. BOOT
     ===================================================================== */
  loadEvents();
  loadStarred().then(function () { loadFeed(true); });
})();
