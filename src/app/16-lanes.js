  // Physical yard positions are shared, confirmed online, and independent of a shift.
  var LP = { data: null, loading: false, error: '', selected: '', query: '', yard: '', busy: false, seq: 0 };
  function laneById(id) { return LP.data && LP.data.lanes.filter(function (x) { return x.id === id; })[0]; }
  function laneCar(id) { return LP.data && LP.data.cars.filter(function (x) { return x.id === id; })[0]; }
  function lanePosition(id) { return LP.data && LP.data.positions.filter(function (x) { return x.booking_id === id; })[0]; }
  function laneOccupants(id) { return LP.data.positions.filter(function (x) { return x.lane_id === id; }).sort(function (a,b) { return a.position-b.position; }); }
  function laneBlockers(p) {
    var l = p && laneById(p.lane_id); if (!l || l.access === 'open') return [];
    var all = laneOccupants(l.id), front = all.filter(function (x) { return x.position < p.position; });
    if (l.access !== 'both') return front;
    var rear = all.filter(function (x) { return x.position > p.position; }).reverse();
    return rear.length < front.length ? rear : front;
  }
  function laneReachable(l, pos) {
    var all = laneOccupants(l.id);
    if (all.some(function (x) { return x.position === pos; })) return false;
    return l.access === 'open' || !all.some(function (x) { return x.position < pos; }) ||
      l.access === 'both' && !all.some(function (x) { return x.position > pos; });
  }
  function laneRisk(p) {
    var c = laneCar(p.booking_id), due = c && Date.parse(c.return_at);
    if (!due) return false;
    return laneBlockers(p).some(function (x) { var b = laneCar(x.booking_id); return !b || !b.return_at || Date.parse(b.return_at) > due; });
  }
  function laneMatch(c) { var q = LP.query.replace(/\s/g,'').toUpperCase(); return !q || ((c.reg || '') + (c.ref || '')).replace(/\s/g,'').toUpperCase().indexOf(q) !== -1; }
  function laneYard(y) { return YARD_LABEL[y] || y; }
  function laneWhen(c) { return c.return_at ? dayShort(c.return_at) + ' ' + hhmm(c.return_at) : 'Return time unknown'; }
  function laneSuggestion(c) {
    // Conservative first version: one-ended lanes only, compatible return order.
    // Load late returns deepest first. Unknown returns never get a parking promise.
    if (!c || !c.return_at) return null;
    var current = lanePosition(c.id), choices = [];
    LP.data.lanes.forEach(function (l) {
      if (l.kind !== 'lane' || l.access !== 'front' || current && current.lane_id === l.id || (c.yard && c.yard !== l.yard)) return;
      var all = laneOccupants(l.id);
      if (all.some(function (p) { var b = laneCar(p.booking_id); return !b || !b.return_at || Date.parse(b.return_at) < Date.parse(c.return_at); })) return;
      for (var i = l.capacity; i >= 1; i--) if (laneReachable(l,i)) {
        var same = all.some(function (p) { var b = laneCar(p.booking_id); return b && b.return_at && londonParts(new Date(b.return_at)).key === londonParts(new Date(c.return_at)).key; });
        choices.push({ lane: l, position: i, rank: (same ? 1000 : 0) + all.length }); break;
      }
    });
    choices.sort(function (a,b) { return b.rank-a.rank || a.lane.name.localeCompare(b.lane.name); }); return choices[0] || null;
  }
  async function loadLanes() {
    if (!S.me || S.platform || LP.loading || LP.busy) return;
    var seq = ++LP.seq, company = S.company.id; LP.loading = true; LP.error = '';
    try {
      var r = await sb.rpc('lane_get');
      if (seq !== LP.seq || !S.company || S.company.id !== company) return;
      if (r.error) LP.error = /lane_get|PGRST202/.test(r.error.message || '') ? 'Lane planner needs database part 104.' : r.error.message;
      else LP.data = r.data;
    } catch (e) { if (seq === LP.seq) LP.error = 'Could not load the yard. Check your connection.'; }
    finally { if (seq === LP.seq) { LP.loading = false; if (S.view === 'lanes') render(); } }
  }
  function laneChanged() { if (S.view === 'lanes' && !LP.busy && !document.querySelector('.lp-form:focus-within')) loadLanes(); }
  function resetLanes() { LP.seq++; LP.data = null; LP.loading = false; LP.error = ''; LP.selected = ''; LP.query = ''; LP.yard = ''; LP.busy = false; }
  function laneSelectButton(c, extra) { return '<button type="button" class="lp-car' + (LP.selected === c.id ? ' selected' : '') + '" data-lpcar="' + esc(c.id) + '"><b>' + esc(c.reg || 'No registration') + '</b><span>' + esc(laneWhen(c)) + '</span>' + (extra || '') + '</button>'; }
  function renderLanes() {
    if (!LP.data && !LP.loading && !LP.error) loadLanes();
    if (!LP.data) return '<div class="msg">' + esc(LP.error || 'Loading the yard…') + (LP.error ? '<p><button type="button" class="btn" data-lpreload>Try again</button></p>' : '') + '</div>';
    var d = LP.data, selected = laneCar(LP.selected), visible = d.lanes.filter(function (l) { return !LP.yard || l.yard === LP.yard; });
    var active = d.positions.filter(function (p) { var l = laneById(p.lane_id); return l && (!LP.yard || l.yard === LP.yard); });
    var risks = active.filter(laneRisk), unlocated = d.cars.filter(function (c) { return !lanePosition(c.id); });
    var h = '<section class="lp"><div class="lp-toolbar"><div><p>' + active.length + ' positioned · ' + risks.length + ' return conflicts · ' + unlocated.length + ' unrecorded</p></div><button type="button" class="btn ghost" data-lpreload' + (LP.loading || LP.busy ? ' disabled' : '') + '>Refresh</button></div>';
    if (LP.error) h += '<p class="lp-alert" role="alert">' + esc(LP.error) + '</p>';
    h += '<div class="lp-filters"><label>Yard<select id="lpYard"><option value="">All yards</option>' + yardOrder().filter(function (y) { return y !== 'T'; }).map(function (y) { return '<option value="' + esc(y) + '"' + (LP.yard === y ? ' selected' : '') + '>' + esc(YARD_LABEL[y] || y) + '</option>'; }).join('') + '</select></label><label>Find a car<input id="lpQuery" type="search" placeholder="Registration or booking reference" value="' + esc(LP.query) + '"></label></div>';
    if (!d.lanes.length) h += '<div class="lp-empty"><h3>Set up your yard</h3><p>Add lanes, holding areas and temporary moving spaces. Then record actual positions, starting at the back of each lane.</p></div>';
    if (risks.length) h += '<div class="lp-alert"><b>Returns needing a move</b><div class="lp-alert-list">' + risks.map(function (p) { var c = laneCar(p.booking_id); return laneSelectButton(c, '<small>' + laneBlockers(p).length + ' blocking · ' + esc(laneById(p.lane_id).name) + '</small>'); }).join('') + '</div></div>';
    h += '<div class="lp-layout"><div class="lp-lanes">';
    visible.forEach(function (l) {
      var all = laneOccupants(l.id), matches = !LP.query || all.some(function (p) { var c = laneCar(p.booking_id); return c && laneMatch(c); });
      if (!matches) return;
      h += '<article class="lp-lane"><header><h3>' + esc(laneYard(l.yard)) + ' / ' + esc(l.name) + '</h3><span>' + all.length + '/' + l.capacity + ' · ' + (l.access === 'open' ? 'Independent spaces' : l.access === 'both' ? 'Exit at both ends' : 'Front exit only') + '</span></header>' + (l.access !== 'open' ? '<div class="lp-exit">FRONT EXIT · position 1</div>' : '') + '<ol>';
      for (var pos=1; pos<=l.capacity; pos++) {
        var p = all.filter(function (x) { return x.position === pos; })[0], c = p && laneCar(p.booking_id), blockers = p && laneBlockers(p);
        h += '<li' + (c && !laneMatch(c) ? ' class="lp-muted"' : '') + '><span class="lp-pos">' + pos + '</span>';
        if (c) h += laneSelectButton(c,'<small class="' + (laneRisk(p) || c.sent_at || c.cleared_at || c.removed_at ? 'lp-warning' : '') + '">' + (c.sent_at || c.cleared_at || c.removed_at ? 'Verify location · board status changed' : laneRisk(p) ? 'Return conflict · ' + blockers.length + ' blocking' : blockers.length ? 'Behind ' + blockers.length + ' car' + (blockers.length===1?'':'s') : 'Accessible') + '</small>');
        else h += '<span class="lp-vacant">Empty' + (laneReachable(l,pos) ? '' : ' · access blocked') + '</span>';
        h += '</li>';
      }
      h += '</ol>' + (l.access === 'both' ? '<div class="lp-exit">REAR EXIT</div>' : '') + '</article>';
    });
    h += '</div><aside class="lp-detail' + (selected ? '' : ' lp-none') + '" aria-live="polite">' + (selected ? laneDetail(selected) : '<h3>Vehicle details</h3><p>Select a registration to see its position, blockers and available moves.</p>') + '</aside></div>';
    h += '<section class="lp-section"><h3>Position not recorded <span>' + unlocated.length + '</span></h3><div class="lp-unlocated">' + unlocated.filter(function (c) { return (!LP.yard || c.yard === LP.yard) && laneMatch(c); }).sort(function (a,b) { return (Date.parse(b.return_at)||0)-(Date.parse(a.return_at)||0); }).map(function (c) { return laneSelectButton(c,'<small>' + esc(c.yard ? laneYard(c.yard) : 'Yard unknown') + ' · ' + esc(c.ref) + '</small>'); }).join('') + '</div></section>';
    if (d.can_manage) h += '<details class="lp-section"><summary>Add lane or holding area</summary><form id="lpAdd" class="lp-form"><label>Yard<select name="yard" required>' + yardOrder().filter(function (y) { return y !== 'T'; }).map(function (y) { return '<option value="' + esc(y) + '">' + esc(laneYard(y)) + '</option>'; }).join('') + '</select></label><label>Name<input name="name" maxlength="40" required placeholder="Lane A"></label><label>Spaces<input name="capacity" type="number" min="1" max="100" value="5" required></label><label>Type<select name="kind"><option value="lane">Parking lane</option><option value="holding">Holding area</option><option value="temporary">Temporary moving spaces</option></select></label><label>Lane exits<select name="access"><option value="front">Front only</option><option value="both">Both ends</option></select></label><button class="btn" type="submit"' + (LP.busy ? ' disabled' : '') + '>Add area</button></form></details>';
    h += '<details class="lp-section"><summary>Recent confirmed moves</summary>' + (d.moves || []).map(function (m) { return '<div class="lp-history"><b>' + esc(m.reg) + '</b><span>' + esc(m.value) + '</span><small>' + esc(m.staff_name) + ' · ' + esc(dayShort(m.at) + ' ' + hhmm(m.at)) + '</small></div>'; }).join('') + '</details></section>';
    return h;
  }
  function laneDetail(c) {
    var p=lanePosition(c.id), l=p && laneById(p.lane_id), blockers=laneBlockers(p), d=LP.data;
    var h='<h3>' + esc(c.reg) + '</h3><p>' + esc(c.make || '') + ' · ' + esc(c.ref || 'No reference') + '</p><dl><dt>Position</dt><dd>' + (l ? esc(laneYard(l.yard) + ' / ' + l.name + ' / ' + p.position) : 'Not recorded') + '</dd><dt>Expected return</dt><dd>' + esc(laneWhen(c)) + '</dd></dl>';
    if (blockers.length) {
      var spaces=[];
      d.lanes.filter(function (x) { return x.yard===l.yard && x.access==='open'; }).sort(function (a,b) { return (a.kind==='temporary'?0:1)-(b.kind==='temporary'?0:1); }).forEach(function (x) { for(var n=1;n<=x.capacity;n++) if(laneReachable(x,n)) spaces.push(x.name+' / '+n); });
      h+='<h4>Move these cars first</h4><ol class="lp-blockers">'+blockers.map(function (x,i) { var b=laneCar(x.booking_id); return '<li>'+laneSelectButton(b,'<small>'+(spaces[i]?'Suggested: '+esc(spaces[i]):'No free holding space recorded')+'</small>')+'</li>'; }).join('')+'</ol>';
      if(spaces.length<blockers.length) h+='<p class="lp-warning">Supervisor planning required: not enough independent moving spaces.</p>';
    }
    var suggestion=(!l || l.kind!=='lane') && laneSuggestion(c);
    if(suggestion) h+='<p class="lp-suggestion">Suggested parking: <b>'+esc(suggestion.lane.name)+' / '+suggestion.position+'</b>. Later returns sit behind this car.</p>';
    if(!d.can_move) return h+'<p>View only</p>';
    if(blockers.length) return h;
    var destinations=d.lanes.filter(function(x){return !l || x.id!==l.id;});
    h+='<form id="lpMove" class="lp-form"><label>Destination<select id="lpDest" name="lane" required><option value="">Choose an area</option>'+destinations.map(function(x){return '<option value="'+esc(x.id)+'">'+esc(laneYard(x.yard)+' / '+x.name)+'</option>';}).join('')+(l?'<option value="left">Car has left the yard</option>':'')+'</select></label><label>Position<select id="lpSlot" name="position" required><option value="">Choose destination first</option></select></label><p class="note">Confirm only after physically moving the car.</p><button type="submit" class="btn"'+(LP.busy?' disabled':'')+'>'+(l?'Confirm moved':'Confirm actual position')+'</button></form>';
    return h;
  }
  function laneDestinationChanged() {
    var el=$('lpDest'), slots=$('lpSlot'), l=laneById(el.value);
    if(el.value==='left') { slots.innerHTML='<option value="">Not applicable</option>'; slots.required=false; slots.disabled=true; return; }
    slots.disabled=false; slots.required=true;
    var h='<option value="">Choose a reachable space</option>';
    if(l) for(var n=1;n<=l.capacity;n++) if(laneReachable(l,n)) h+='<option value="'+n+'">Position '+n+'</option>';
    slots.innerHTML=h;
  }
  document.addEventListener('submit',async function(e) {
    if(e.target.id!=='lpAdd' && e.target.id!=='lpMove') return;
    e.preventDefault(); if(LP.busy) return;
    if(LP.loading) return toast('Wait for the yard to finish refreshing.',true);
    if(!navigator.onLine) return toast('Reconnect before confirming a yard change.',true);
    var form=e.target, values=new FormData(form), args, method;
    if(form.id==='lpAdd') {
      var kind=values.get('kind'); method='lane_save'; args={p_yard:values.get('yard'),p_name:values.get('name'),p_capacity:+values.get('capacity'),p_kind:kind,p_access:kind==='lane'?values.get('access'):'open'};
    } else {
      var c=laneCar(LP.selected), p=lanePosition(LP.selected), l=laneById(values.get('lane'));
      if(!c || !values.get('lane')) return;
      method='lane_move'; args={p_booking:c.id,p_lane:l?l.id:null,p_position:l?+values.get('position'):null,p_revision:p?p.revision:0,p_lane_revision:l?l.revision:null};
    }
    var requestCompany=S.company.id, requestSeq=LP.seq;
    LP.busy=true; var btn=form.querySelector('button[type="submit"]'); btn.disabled=true;
    try {
      var result=await sb.rpc(method,args);
      if(!S.company || S.company.id!==requestCompany || LP.seq!==requestSeq) return;
      if(result.error) { toast(result.error.message,true); LP.error=result.error.message; }
      else { if(method==='lane_move') LP.data=result.data; toast(method==='lane_save'?'Area added.':'Position confirmed.'); }
    } catch(e) { if(!S.company || S.company.id!==requestCompany || LP.seq!==requestSeq) return; LP.error='Confirmation could not be verified. Refresh the yard before trying again.'; toast(LP.error,true); }
    finally { if(S.company && S.company.id===requestCompany && LP.seq===requestSeq) { LP.busy=false; await loadLanes(); } }
  });
  document.addEventListener('change',function(e) {
    if(e.target.id==='lpYard') { LP.yard=e.target.value; render(); }
    if(e.target.id==='lpDest') laneDestinationChanged();
  });
  document.addEventListener('input',function(e) {
    if(e.target.id!=='lpQuery') return;
    var pos=e.target.selectionStart; LP.query=e.target.value; render(); var q=$('lpQuery'); q.focus(); try { q.setSelectionRange(pos,pos); } catch(e) {}
  });
  setInterval(function(){ if(S.me && S.view==='lanes' && document.visibilityState==='visible') laneChanged(); },15000);
