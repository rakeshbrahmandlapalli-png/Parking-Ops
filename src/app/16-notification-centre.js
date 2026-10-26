  // Shared operational inbox. Nothing is stored in localStorage or the offline
  // booking queue: acceptance must be confirmed by the server.
  var NC = { items: [], ready: false, loaded: false, loading: false, error: '', seq: 0, timer: null, tab: 'all', selected: '', busy: false, options: {}, draft: null };
  function resetNotificationCentre() {
    clearInterval(NC.timer); NC.seq++;
    NC.items = []; NC.loaded = NC.loading = NC.ready = NC.busy = false;
    NC.selected = NC.error = ''; NC.options = {}; NC.draft = null; NC.timer = null; S.notify = null;
    notificationBadge();
    if ($('main') && $('main').dataset.view==='notifications') { $('main').innerHTML=''; $('main').dataset.view=''; }
  }
  function startNotificationCentre() {
    clearInterval(NC.timer); syncCurrentPushSubscription(); loadNotificationCentre();
    NC.timer = setInterval(function () { if (S.me && !S.platform && document.visibilityState === 'visible') loadNotificationCentre(); }, 45000);
    openNotificationLink();
  }
  async function loadNotificationCentre() {
    if (!S.me || S.platform || NC.loading || NC.busy) return;
    var seq = ++NC.seq, uid = S.me.id, company = S.me.company_id;
    NC.loading = true;
    try {
      var r = await sb.rpc('ops_notification_feed');
      if (seq !== NC.seq || !S.me || S.me.id !== uid || S.me.company_id !== company) return;
      if (r.error) throw r.error;
      NC.ready = !!(r.data && Array.isArray(r.data.items));
      NC.items = NC.ready ? r.data.items : []; NC.options = NC.ready ? (r.data.options || {}) : {};
      NC.error = ''; NC.loaded = true; NC.at = new Date();
    } catch (e) {
      if (seq !== NC.seq || !S.me || S.me.id !== uid) return;
      NC.error = /PGRST202|42883/.test(String(e.code)) ? 'The notification centre needs its database update. Existing phone alerts still work.' : (e.message || 'Could not refresh notifications.');
      NC.loaded = true;
    } finally {
      if (seq === NC.seq) {
        NC.loading = false; notificationBadge();
        if (S.me && S.view === 'notifications') render();
      }
    }
  }
  function ncUnread() { return NC.items.filter(function (x) { return !x.read_at && !x.resolved; }).length; }
  function notificationBadge() {
    var b = $('notifyBadge'), button = $('notifyBtn'); if (!b || !button) return;
    var n = ncUnread(), t = n ? (n > 99 ? '99+' : String(n)) : '';
    b.textContent = t;
    button.setAttribute('aria-label', 'Notifications' + (n ? ', ' + n + ' unread' : ''));
  }
  function ncWhen(at) { return at ? dayShort(at) + ' ' + hhmm(at) : ''; }
  function ncItem(id) { return NC.items.filter(function (n) { return n.id === id || n.event_key === id; })[0]; }
  function ncStatus(n) { return n.resolved ? 'Resolved' : n.claimed_by ? 'Accepted by ' + (n.claimed_name || 'staff') : n.urgency === 'urgent' ? 'Urgent · needs attention' : 'Update'; }
  function ncButton(n, attr, label, primary) { return '<button type="button" class="btn ' + (primary ? 'brand' : 'ghost') + '" data-' + attr + '="' + esc(n.id) + '"' + (NC.busy || !navigator.onLine ? ' disabled' : '') + '>' + esc(label) + '</button>'; }
  function ncActions(n) {
    var h = '';
    if (!n.resolved && n.can_accept && !n.claimed_by) h += ncButton(n, 'ncaccept', 'Accept task', true);
    if (!n.resolved && n.claimed_by && (n.claimed_by === S.me.id || can('called'))) h += ncButton(n, 'ncrelease', 'Release task', false);
    if (n.booking_id) h += ncButton(n, 'ncbooking', 'Open booking', false);
    if (n.kind === 'calls' && callsAddon() && can('callpop')) h += '<button type="button" class="btn ghost" data-nccalls>Open calls</button>';
    if (n.kind === 'import' && can('import')) h += '<button type="button" class="btn ghost" data-view="import">Open imports</button>';
    if (n.kind === 'lanes' && lanePlanner()) h += '<button type="button" class="btn ghost" data-view="lanes">View yard planner</button>';
    if (n.kind === 'keys') h += ncButton(n, 'nckeys', 'Open key check', false);
    return h;
  }
  function renderNotifications() {
    if (!NC.loaded && !NC.loading) loadNotificationCentre();
    var selected = ncItem(NC.selected), h = '<section class="nc"><div class="nc-head"><div><p>' + (NC.at ? 'Updated ' + hhmm(NC.at.toISOString()) + ' · last 7 days' : 'Your team alerts in one place') + '</p></div><div class="row-actions"><button type="button" class="btn ghost small" data-ncrefresh' + (NC.loading ? ' disabled' : '') + '>Refresh</button><button type="button" class="btn ghost small" data-ncsettings>Preferences</button></div></div>';
    if (NC.error) h += '<p class="nc-warning" role="alert">' + esc(NC.error) + '</p>';
    if (!navigator.onLine) h += '<p class="nc-warning" role="status">Offline. This list may be out of date. Connect before accepting a task.</p>';
    if (!NC.loaded) return h + '<p role="status">Loading notifications…</p></section>';
    if (!NC.ready) return h + '<p class="nc-empty">Notification history will be available after the database update. Phone alert settings are still available in Me.</p></section>';
    if (NC.selected === 'settings') return h + ncSettingsHtml() + '</section>';
    if (selected) return h + ncDetailHtml(selected) + '</section>';
    var active = NC.items.filter(function (n) { return !n.resolved; }), urgent = active.filter(function (n) { return n.urgency === 'urgent'; }), mine = active.filter(function (n) { return n.claimed_by === S.me.id; });
    h += '<nav class="nc-tabs" aria-label="Filter notifications">' + [['all','All',active.length],['urgent','Urgent',urgent.length],['mine','Mine',mine.length],['history','Resolved',NC.items.length-active.length]].map(function (t) { return '<button type="button" data-nctab="' + t[0] + '" aria-pressed="' + (NC.tab === t[0]) + '">' + t[1] + ' <span>' + t[2] + '</span></button>'; }).join('') + '</nav>';
    var rows = NC.tab === 'urgent' ? urgent : NC.tab === 'mine' ? mine : NC.tab === 'history' ? NC.items.filter(function (n) { return n.resolved; }) : active;
    rows = rows.slice().sort(function (a,b) { return Number(b.urgency === 'urgent')-Number(a.urgency === 'urgent') || Number(!!a.claimed_by)-Number(!!b.claimed_by) || Date.parse(b.created_at)-Date.parse(a.created_at); });
    if (!rows.length) h += '<div class="nc-empty"><strong>' + (NC.tab === 'mine' ? 'No tasks accepted by you' : 'Nothing here right now') + '</strong><p>New alerts will appear here when the team needs them.</p></div>';
    h += '<div class="nc-list">' + rows.map(function (n) { return '<article class="nc-row ' + (n.resolved ? 'nc-done' : n.urgency === 'urgent' ? 'nc-urgent' : '') + '"><div class="nc-meta"><span>' + esc(ncStatus(n)) + '</span><time>' + esc(ncWhen(n.created_at)) + '</time></div><button type="button" class="nc-title" data-ncopen="' + esc(n.id) + '">' + (!n.read_at ? '<span class="nc-dot" aria-label="Unread"></span>' : '') + esc(n.title) + '</button><p>' + esc(n.body) + '</p>' + (n.escalated_at ? '<small>Escalated to supervisors ' + esc(hhmm(n.escalated_at)) + '</small>' : '') + '<div class="row-actions">' + ncActions(n) + '</div></article>'; }).join('') + '</div></section>';
    return h;
  }
  function ncDetailHtml(n) {
    var h = '<button type="button" class="btn ghost small" data-ncback>‹ All notifications</button><article class="nc-detail"><p class="nc-status">' + esc(ncStatus(n)) + '</p><h3>' + esc(n.title) + '</h3><p>' + esc(n.body) + '</p>';
    if (n.booking_id) h += '<dl><dt>Registration</dt><dd>' + esc(n.reg || 'Not recorded') + '</dd><dt>Yard location</dt><dd>' + esc(n.yard || 'Not recorded') + '</dd><dt>Key tag</dt><dd>' + esc(n.key_tag == null ? 'Not recorded' : String(n.key_tag)) + '</dd><dt>Handling this</dt><dd>' + esc(n.claimed_name || 'Unassigned') + '</dd></dl>';
    h += '<div class="row-actions">' + ncActions(n) + '</div>';
    if (!n.resolved && n.can_accept && can('called')) {
      var people = Object.values(S.staff).filter(function (s) { return s.active; });
      h += '<div class="nc-assign"><label>Assign to staff<select id="ncAssignee"><option value="">Choose a person</option>' + people.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join('') + '</select></label>' + ncButton(n, 'ncassign', 'Assign task', false) + '</div>';
    }
    h += '<p class="note">Accepting only says who is on it. Mark SENT, RTC and the rest on the booking as usual.</p><h4>Activity</h4><ol class="nc-timeline"><li><time>' + esc(ncWhen(n.created_at)) + '</time><span>Alert created</span></li>';
    h += (n.activity || []).map(function (a) { return '<li><time>' + esc(ncWhen(a.at)) + '</time><span>' + esc(a.action) + (a.staff_name ? ' · ' + esc(a.staff_name) : '') + '</span></li>'; }).join('');
    if (n.resolved) h += '<li>Resolved from the current booking or check state, or expired.</li>';
    return h + '</ol>' + (!n.resolved && n.urgency === 'urgent' && n.can_accept ? '<p class="nc-warning">Unaccepted urgent tasks are escalated on the first 5-minute timer run after they have waited 5 minutes.</p>' : '') + '</article>';
  }
  function ncSettingsHtml() {
    return '<button type="button" class="btn ghost small" data-ncback>‹ All notifications</button><div class="nc-detail"><h3>Notification preferences</h3>' + notifyHtml() + '<div class="nc-options"><label><input id="ncSilent" type="checkbox"' + ((NC.draft ? NC.draft.silent : NC.options.routine_silent) ? ' checked' : '') + '> Silent routine push alerts</label><p class="note">Urgent alerts request normal device behaviour. Your phone controls sound and Do Not Disturb.</p><label>Pause operational push alerts<select id="ncPause">' + [[-1,'Keep current setting'],[0,'Receive alerts now'],[1,'Pause for 1 hour'],[8,'Pause for 8 hours']].map(function(x){ return '<option value="'+x[0]+'"'+(NC.draft && NC.draft.pause===x[0]?' selected':'')+'>'+x[1]+'</option>'; }).join('') + '</select></label><p class="note">' + (NC.options.paused_until && Date.parse(NC.options.paused_until) > Date.now() ? 'Paused until ' + esc(ncWhen(NC.options.paused_until)) + '. ' : '') + 'The inbox keeps receiving alerts. Account and system warnings still arrive.</p><button type="button" class="btn brand" data-ncsave' + (NC.busy ? ' disabled' : '') + '>Save preferences</button></div></div>';
  }
  async function ncAct(id, action, staff) {
    var n = ncItem(id); if (!n || NC.busy || !S.me) return;
    if (!navigator.onLine) return toast('Connect before changing a shared task.', true);
    var uid = S.me.id, seq = NC.seq;
    NC.busy = true; render();
    try {
      var r = await sb.rpc('ops_notification_action', {p_id:n.id,p_action:action,p_staff:staff || null});
      if (!S.me || uid !== S.me.id || seq !== NC.seq) return;
      if (r.error) throw r.error;
      if (action !== 'read') toast(action === 'accept' ? 'Task accepted' : action === 'assign' ? 'Task assigned' : 'Task released');
    } catch (e) { if (S.me && uid === S.me.id) toast(e.message || 'Could not update this task.', true); }
    finally { if (S.me && uid === S.me.id && seq === NC.seq) { NC.busy = false; await loadNotificationCentre(); } }
  }
  async function ncSaveOptions() {
    if (NC.busy || !S.me) return;
    var hours = +$('ncPause').value, silent = $('ncSilent').checked, uid = S.me.id;
    if (hours === -1) hours = NC.options.paused_until && Date.parse(NC.options.paused_until) > Date.now() ? -1 : 0;
    // -1 preserves the exact server timestamp instead of extending a pause.
    NC.busy = true;
    try { var r = await sb.rpc('set_ops_notification_options', {p_pause_hours:hours,p_routine_silent:silent}); if (r.error) throw r.error; if (S.me && S.me.id === uid) { NC.draft=null; toast('Preferences saved'); } }
    catch (e) { if (S.me && S.me.id === uid) toast(e.message || 'Could not save preferences.',true); }
    finally { if (S.me && S.me.id === uid) { NC.busy = false; await loadNotificationCentre(); } }
  }
  async function ncOpenBooking(id, keys) {
    var n = ncItem(id); if (!n || !n.booking_id || !S.me) return;
    var uid = S.me.id;
    try {
      var r = await sb.from('bookings').select('*').eq('id',n.booking_id).maybeSingle();
      if (!S.me || uid !== S.me.id) return;
      if (r.error) throw r.error; if (!r.data || r.data.company_id !== S.me.company_id) throw new Error('This booking is no longer available.');
      if (go('board') === false) return;
      await openArchived(r.data.sheet_id,r.data.reg);
      if (!S.me || uid !== S.me.id) return;
      if (keys) { if (!keyOn()) await toggleKeyMode(); return; }
      var row = S.rows.filter(function (x) { return x.id === r.data.id; })[0];
      if (row) openPanel(row); else toast('The booking moved or is no longer on this sheet. Refresh and try again.',true);
    } catch(e) { if (S.me && uid === S.me.id) toast(e.message || 'Could not open this booking.',true); }
  }
  async function openNotificationLink() {
    var params = new URL(location.href).searchParams, notice = params.get('notice'), booking = params.get('booking');
    if ((!notice && !booking) || !S.me || S.platform) return;
    if (S.view !== 'notifications' && go('notifications') === false) return;
    // Await a fresh list for this session, not a late result from the PIN screen.
    if (NC.loading) { setTimeout(openNotificationLink,100); return; }
    await loadNotificationCentre();
    if (!S.me) return;
    var n = notice ? ncItem(notice) : NC.items.filter(function (x) { return x.booking_id === booking; })[0];
    if (n) { NC.selected=n.id; render(); ncAct(n.id,'read'); }
    else toast('This alert is unavailable, expired or belongs to another account.',true);
    params.delete('notice'); params.delete('booking');
    var url = new URL(location.href); url.search=params.toString(); history.replaceState(null,'',url.pathname+url.search+url.hash);
  }
  document.addEventListener('change',function(e){ if(e.target.id==='ncSilent'||e.target.id==='ncPause') NC.draft={silent:$('ncSilent').checked,pause:+$('ncPause').value}; });
  document.addEventListener('visibilitychange',function () { if (S.me && document.visibilityState==='visible') loadNotificationCentre(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message',function (e) {
    if (!S.me || !e.data) return;
    if (e.data.type==='PUSH_SUBSCRIPTION_CHANGED') { syncCurrentPushSubscription(); return; }
    if (e.data.type!=='OPEN_NOTIFICATION') return;
    var u = new URL(e.data.url,location.origin); if (u.origin!==location.origin) return;
    history.replaceState(null,'',u.pathname+u.search+location.hash); openNotificationLink();
  });
