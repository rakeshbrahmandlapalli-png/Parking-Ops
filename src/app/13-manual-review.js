  // Reviewed manual imports: parsing stays on the device. Checking sends only
  // booking columns to a read-only RPC, and applying rechecks its snapshot.
  function local(dt) { return dt ? dt.key + ' ' + (dt.time || '') : ''; }
  function biProtected() { return '<p class="bi-protected">Operational details protected <small>Keys, lane positions, drivers, payments and staff notes are kept.</small></p>'; }
  function biSteps(stage) { return '<ol class="bi-progress" aria-label="Import progress">' + ['Files','Review','Import'].map(function(x,i){ return '<li' + (i===stage ? ' aria-current="step"' : '') + '><span>' + (i+1) + '</span>' + x + '</li>'; }).join('') + '</ol>'; }
  function manualFiles(I) { return I.bookingFiles || (I.excelFile ? [I.excelFile] : []); }
  function manualFileHtml(I) {
    var checked = I.stage === 'preview' || I.stage === 'done', listCount=(I.fileInfo || manualFiles(I)).length;
    var h = checked ? '<details class="mi-files"' + (window.innerWidth>=720?' open':'') + '><summary>Files checked · '+listCount+'</summary>' : '<section class="mi-files" aria-label="Import files">';
    h += '<div class="bi-rh">' + (checked?'':'<h3>Choose files</h3>') + '<label class="mi-add">' + (checked ? 'Replace files' : 'Add files') + '<input type="file" data-file="excel" multiple accept=".xls,.xlsx,.csv,.txt,.pdf"' + (I.saving || I.checking || I.stage==='reading' ? ' disabled' : '') + '></label></div>';
    var files = I.fileInfo || manualFiles(I).map(function(f){ return {name:f.name, detail:'Ready to check', type:/\.pdf$/i.test(f.name) ? 'PDF' : 'Spreadsheet'}; });
    if (!files.length) h += '<p class="bi-hint">Choose booking spreadsheets or Joblist PDFs. You can add several files together.</p>';
    files.forEach(function(f){ h += '<div class="mi-file"><span><b>' + esc(f.name) + '</b><small>' + esc((f.type || '') + ' · ' + (f.detail || '')) + '</small></span><span class="bi-pill' + (f.ok ? ' s-new' : '') + '">' + (f.ok ? 'Checked' : 'Selected') + '</span></div>'; });
    if (I.pdfFile && !files.some(function(f){ return f.name===I.pdfFile.name; })) h += '<div class="mi-file"><span><b>' + esc(I.pdfFile.name) + '</b><small>Return flight report</small></span></div>';
    if (I.kind === 'drops' && !checked && !manualFiles(I).every(function(f){return /\.pdf$/i.test(f.name);})) h += '<label class="mi-add mi-flight">' + (I.pdfFile ? 'Replace flight report' : 'Add flight report (optional)') + '<input type="file" data-file="pdf" accept=".pdf"></label><p class="bi-hint">Skip this if your booking files already contain flight numbers.</p>';
    return h + (I.flightCheck?'<p class="bi-hint">'+esc(I.flightCheck)+'</p>':'') + (checked?'</details>':'</section>');
  }
  function manualPanel(I) {
    var busy = I.saving || I.stage === 'reading', h = biSteps(I.stage==='done'?2:I.stage==='preview'?1:0);
    if (I.stage === 'done') return h + manualResultHtml(I);
    if (I.stage !== 'preview') h += '<div class="toolbar"><div class="seg" role="group" aria-label="Sheet type">' + ['drops','picks'].map(function(k){return '<button type="button" data-impkind="' + k + '" aria-pressed="' + (I.kind===k) + '"' + (busy?' disabled':'') + '>' + (k==='drops'?'Drops':'Picks') + '</button>';}).join('') + '</div></div>';
    h += manualFileHtml(I);
    if (I.error) h += '<div class="alert" role="alert">' + esc(I.error) + '</div>';
    if (I.stage !== 'preview') return h + '<div class="row-actions"><button type="button" class="btn brand" data-read' + (!manualFiles(I).length || busy ? ' disabled' : '') + '>' + (busy ? 'Checking files…' : 'Check files') + '</button></div>' + recentImportsHtml();
    var P=I.plan, counts=P && P.counts || {}, selected=manualSelected(I), f=I.filter || 'all';
    h += '<div class="inline-selects"><label for="impDate">Review sheet</label><select id="impDate" data-impdate><option value="all"' + (I.reviewDay==='all'?' selected':'') + '>All dates (' + I.real.dates.length + ')</option>' + I.real.dates.map(function(k){return '<option value="' + k + '"' + (I.reviewDay===k?' selected':'') + '>' + esc(R.boardName(k,I.kind)) + ' · ' + I.real.counts[k] + '</option>';}).join('') + '</select>' + (I.kind==='drops'?'<label for="impCut">Day ends at</label><select id="impCut" data-impcut>' + ['04:00','05:00','06:00','07:00'].map(function(t){return '<option' + (t===I.cutoff?' selected':'') + '>' + t + '</option>';}).join('') + '</select>':'') + '</div>';
    h += '<p class="bi-hint">' + esc(I.real.dates.map(function(k){ return biDay(k) + ': ' + I.real.counts[k] + ' ' + I.kind; }).join(' · ')) + '</p>' + biProtected();
    if (I.issues && I.issues.length) h += '<details class="mi-issues" open><summary>' + I.issues.length + ' file issue(s) held for review</summary>' + I.issues.map(function(x){return '<p>' + esc(x) + '</p>';}).join('') + '</details>';
    if (I.checking) return h + '<p role="status">Comparing with existing bookings…</p>';
    if (!P) return h + '<button type="button" class="btn brand" data-manualcheck>Check against board</button>';
    h += '<h3>Review import</h3><div class="bi-counts">' + [['new','New'],['changed','Updated'],['review','Needs review'],['unchanged','Unchanged']].map(function(x){return '<div><b class="num">' + (counts[x[0]] || 0) + '</b><span>' + x[1] + '</span></div>';}).join('') + '</div>';
    if(counts.invalid) h += '<p class="bi-warn">' + counts.invalid + ' invalid booking(s) held back. Correct the file and check it again.</p>';
    h += '<div class="bi-filters">' + [['all','Changes'],['review','Needs review'],['unchanged','Unchanged']].map(function(x){return '<button type="button" class="bi-chip" data-manualfilter="' + x[0] + '" aria-pressed="' + (x[0]===f) + '">' + x[1] + '</button>';}).join('') + '<input type="search" id="miQ" class="bi-search" placeholder="Reference or registration" aria-label="Search manual import" value="' + esc(I.q || '') + '"></div>';
    var items=P.items.filter(function(i){return (I.reviewDay==='all' || i.day===I.reviewDay) && (f==='all' ? i.status!=='unchanged' : f==='review' ? i.status==='review'||i.status==='invalid':i.status==='unchanged');});
    h += '<label class="mi-selectall"><input type="checkbox" data-manualall' + (selected.length && selected.length===P.items.filter(manualReady).length?' checked':'') + (busy?' disabled':'') + '> Select all ready changes across all dates</label><div class="mi-rows">';
    items.forEach(function(i){
      var ready=manualReady(i), q=biQ(i.ref,i.reg), hidden=I.q && q.indexOf(I.q.toLowerCase().replace(/\s+/g,''))<0;
      h += '<article class="mi-row s-' + i.status + '" data-miq="' + esc(q) + '"' + (hidden?' hidden':'') + '><label class="mi-select"><input type="checkbox" data-manualselect="' + esc(i.key) + '" aria-label="Select ' + esc(i.ref || 'unreadable booking') + '"' + (ready && I.selected[i.key]?' checked':'') + (!ready||busy?' disabled':'') + '></label><div class="mi-detail"><div><b>' + esc(i.ref || 'No reference') + ' · ' + esc(i.reg || 'No registration') + '</b><em class="bi-pill s-' + i.status + '">' + esc(BI_STATUS[i.status]) + '</em></div><small>' + esc(i.kind.toUpperCase() + ' · ' + biDay(i.day) + (i.source?' · '+i.source:'')) + '</small>';
      h += '<p>' + esc(i.reason || (i.status==='new'?'New booking':i.status==='unchanged'?'No changes':(i.changes||[]).map(biChange).join(' · '))) + '</p>';
      if (i.status==='review' && i.changes && i.changes.length) h += '<p>' + esc(i.changes.map(biChange).join(' · ')) + '</p>';
      if(i.attention) h += '<p class="bi-attention">' + esc(i.attention) + '</p>';
      if(i.lane || i.yard || i.number) h += '<small>' + esc([i.lane?'Lane '+i.lane+(i.position?' · Position '+i.position:''):i.yard?'Yard '+i.yard:'',i.number?'Board #'+i.number:''].filter(Boolean).join(' · ')) + '</small>';
      if(i.booking_id) h += '<div class="bi-racts"><button type="button" class="link" data-manualopen="' + esc(i.key) + '">Open booking</button>' + (i.can_resolve?'<button type="button" class="link" data-manualincoming="'+esc(i.key)+'">Use incoming values</button>':'') + (i.status==='review'?'<button type="button" class="link" data-manualkeep="' + esc(i.key) + '">Keep current</button>':'') + '</div>';
      h += '</div></article>';
    });
    h += (items.length?'':'<p class="bi-hint">No bookings in this view.</p>') + '</div><details class="bi-diag"><summary>View extracted bookings</summary><div class="table-wrap"><table><thead><tr><th>File / row</th><th>Ref</th><th>Reg</th><th>Customer</th><th>Car</th><th>Drop-off</th><th>Back</th><th>Flight</th></tr></thead><tbody>' + I.preview.rows.map(function(r,i){return '<tr><td>' + esc(r._source || '') + '</td><td>' + esc(r.ref) + '</td><td>' + esc(r.reg) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.make) + '</td><td>' + esc(local(r.meet)) + '</td><td>' + esc(local(r.ret)) + '</td><td>' + (I.kind==='drops'?'<input data-fix="' + i + '" value="' + esc(r.flight || '') + '" placeholder="Flight" aria-label="Flight for ' + esc(r.reg) + '">':esc(r.flight || '')) + '</td></tr>';}).join('') + '</tbody></table></div></details>';
    h += '<div class="mi-action" role="group" aria-label="Import actions"><span>' + selected.length + ' selected · ' + ((counts.review||0)+(counts.invalid||0)+(I.issues||[]).length) + ' held for review</span><div><button type="button" class="btn ghost" data-manualcheck' + (busy?' disabled':'') + '>Check again</button><button type="button" class="btn brand" data-create' + (!selected.length||busy?' disabled':'') + '>' + (I.saving?'Importing…':I.failed?'Retry '+selected.length+' selected':'Import '+selected.length+' selected') + '</button></div></div><button type="button" class="link" data-restart' + (busy?' disabled':'') + '>Start again</button>';
    return h;
  }
  function manualReady(i) { return i.status==='new'||i.status==='changed'; }
  function manualSelected(I) { return I.plan ? I.plan.items.filter(function(i){return manualReady(i)&&I.selected[i.key];}).map(function(i){return i.key;}) : []; }
  async function readImport() {
    var I=S.imp; if(!I || I.stage==='reading'||I.saving) return;
    I.stage='reading'; I.error=''; I.plan=null; I.fileInfo=[]; I.issues=[]; I.real={all:[]}; render();
    try {
      var reports=[], files=manualFiles(I), bookingCount=0;
      if(!files.length) throw new Error('Choose a booking file first.');
      if(files.length>20 || files.reduce(function(n,f){return n+f.size;},0)>40*1024*1024)throw new Error('Check up to 20 files totalling 40 MB at a time.');
      for(var i=0;i<files.length;i++) {
        var file=files[i], got, type=/\.pdf$/i.test(file.name)?'Joblist PDF':'Spreadsheet';
        if(file.size>10*1024*1024) throw new Error(file.name+': choose a file smaller than 10 MB.');
        if(/\.pdf$/i.test(file.name)) {
          try {got=await R.readJoblistPdf(file);} catch(err) {
            try {reports.push(await R.readPdf(file)); I.fileInfo.push({name:file.name,type:'Flight report',detail:'Will match by booking reference',ok:true}); continue;}
            catch(reportError){throw new Error(file.name+': '+err.message);}
          }
        } else got=await R.readExcel(file);
        if(got.kind && got.kind!==I.kind) throw new Error(file.name+': this is a '+got.kind.toUpperCase()+' report. Switch the selected board type and check again.');
        if(!got.rows.length) throw new Error(file.name+': no bookings could be read.');
        bookingCount++;
        got.rows.forEach(function(r,idx){r._source=file.name+' · '+(r.source_page?'Page '+r.source_page:'Row '+(r.source_row || idx+1)); I.real.all.push(r);});
        var dates={}; got.rows.forEach(function(r){var d=r[I.kind==='drops'?'ret':'meet'];if(d) dates[d.key]=1;});
        I.fileInfo.push({name:file.name,type:type,detail:I.kind.toUpperCase()+' · '+Object.keys(dates).sort().map(biDay).join(', ')+' · '+got.rows.length+' bookings',ok:true});
      }
      if(!bookingCount) throw new Error('Only flight reports were found. Add a booking spreadsheet or Joblist PDF.');
      if(I.pdfFile) reports.push(await R.readPdf(I.pdfFile));
      var flights=[].concat.apply([],reports);
      if(flights.length) {
        var refs={}; I.real.all.forEach(function(r){if(r.ref) refs[r.ref]=true;});
        var matched=flights.filter(function(r){return r.ref && refs[r.ref];}).length;
        if(!matched) throw new Error('The flight report has no booking references matching these files. Choose the report for the same dates.');
        var flightMap={}; flights.forEach(function(r){if(!r.ref||!r.flight) return; if(flightMap[r.ref] && flightMap[r.ref]!==r.flight) throw new Error('The flight reports disagree for '+r.ref+'. Choose the correct report.'); flightMap[r.ref]=r.flight;});
        var byRef={};I.real.all.forEach(function(r){byRef[r.ref]=r;});flights.forEach(function(r){if(r.report_date && byRef[r.ref] && byRef[r.ref].ret && r.report_date!==byRef[r.ref].ret.key)throw new Error('Flight report date does not match booking '+r.ref+'. Choose the report for the same return dates.');});
        I.flightCheck=flights.some(function(r){return r.report_date;})?'Flight references and available report dates checked.':'Flights matched by reference. This report has no readable dates to verify.';
        R.matchFlights(I.real.all,flights,'flightIn');
        if(matched< Object.keys(refs).length) I.issues.push('Flight report matched '+matched+' report rows. Unmatched bookings keep their existing flight; check missing flight numbers.');
      }
      var field=I.kind==='drops'?'ret':'meet', times={};
      I.real.all.forEach(function(r){if(r[field]) times[r[field].time||'none']=1;else I.issues.push(r._source+': missing or unreadable '+(I.kind==='drops'?'return':'drop-off')+' date; this booking is held back.');});
      if(I.real.all.length>=5&&Object.keys(times).length===1) throw new Error('Every car in this file has the same '+(I.kind==='drops'?'return':'drop-off')+' time ('+Object.keys(times)[0]+'), so the times could not be verified. Nothing was imported.');
      groupImport(); if(!I.real.dates.length) throw new Error('No usable booking dates were found. Nothing was imported.');
      I.reviewDay='all'; buildPreview('all'); await checkManualImport();
    }catch(err){I.stage='pick';I.error=err.message||String(err);I.fileInfo=null;render();}
  }
  function groupImport(){ var I=S.imp, counts={}; I.real.all.forEach(function(r){var k=shiftKey(r[I.kind==='drops'?'ret':'meet'],I.cutoff);if(k) counts[k]=(counts[k]||0)+1;});I.real.counts=counts;I.real.dates=Object.keys(counts).sort(); }
  function buildPreview(day) {
    var I=S.imp; I.reviewDay=day||'all';
    I.preview={dateKey:I.reviewDay,rows:I.real.all.filter(function(r){return I.reviewDay==='all'||shiftKey(r[I.kind==='drops'?'ret':'meet'],I.cutoff)===I.reviewDay;})};
    I.preview.rows.forEach(function(r){if(r.flight===undefined) r.flight=I.kind==='drops'?(r.flightIn||''):'';});
    I.stage='preview';render();
  }
  function manualBatches(I) {
    return I.real.dates.map(function(day){return {kind:I.kind,day:day,cutoff:I.cutoff,rows:I.real.all.filter(function(r){return shiftKey(r[I.kind==='drops'?'ret':'meet'],I.cutoff)===day;}).map(function(r){return {ref:r.ref,reg:r.reg,name:r.name,phone:r.phone,make:r.make,drop_local:local(r.meet),return_local:local(r.ret),flight:r.flight===undefined?r.flightIn||'':r.flight,note:r.note||'',source:r._source||'',cancelled:!!r.cancelled};})};});
  }
  async function checkManualImport() {
    var I=S.imp; if(!I || I.saving || I.checking) return;
    I.checking=true;I.error='';I.plan=null;I.pending=null;I.failed=false;render();
    try {
      var batches=manualBatches(I), r=await sb.rpc('reviewed_import_preview',{p_batches:batches});
      if(r.error) throw new Error(/reviewed_import_preview/.test(r.error.message)?'Reviewed imports need the prepared database update before they can be used. Nothing was imported.':r.error.message);
      if(S.imp!==I) return;
      if(!r.data||!Array.isArray(r.data.items))throw new Error('The review service returned no booking details. Nothing was imported.');I.plan=r.data;I.batches=batches;I.selected={};I.plan.items.forEach(function(x){if(manualReady(x)) I.selected[x.key]=true;});I.request=crypto.randomUUID();
    }catch(err){I.error=err.message||String(err);}finally{I.checking=false;if(S.imp===I)render();}
  }
  async function createSheet() {
    var I=S.imp;if(!I||I.saving||!I.plan)return;
    var selected=manualSelected(I);if(!selected.length)return;
    I.saving=true;I.error='';render();
    // Keep this exact payload after a lost response: request IDs are idempotent.
    var args=I.pending || {p_batches:I.batches,p_hash:I.plan.hash,p_selected:selected,p_request:I.request,p_source:{files:(I.fileInfo||[]).map(function(f){return {name:f.name,type:f.type};}),excel:I.excelFile&&I.excelFile.name,pdf:I.pdfFile&&I.pdfFile.name}};
    I.pending=args;
    try {
      var r=await sb.rpc('reviewed_import_apply',args);
      if(r.error) throw new Error(r.error.message);
      I.result=r.data;I.stage='done';I.pending=null;S.recentImports=null;S.importHistory=null;
      await loadSheets();await loadRows();
    }catch(err){I.error=err.message||String(err);I.failed=true;}
    finally{I.saving=false;render();}
  }
  function manualResultHtml(I) {
    var days=I.result.days||[], added=0,updated=0;days.forEach(function(d){added+=d.added||0;updated+=d.updated||0;});
    return '<section class="mi-result" role="status"><h3>Import complete</h3><p>'+added+' added · '+updated+' updated across '+days.length+' sheet(s).</p><p>Unselected and held bookings were left for review.</p><div class="row-actions">'+days.map(function(d){return '<button type="button" class="btn ghost" data-importboard="'+esc(d.sheet_id)+'">View '+esc(d.kind.toUpperCase()+' '+biDay(d.day))+'</button>';}).join('')+'<button type="button" class="btn" data-importreview>Review remaining</button><button type="button" class="btn ghost" data-restart>New import</button></div></section>'+biProtected()+recentImportsHtml();
  }
  async function manualOpen(key){var I=S.imp,item=I.plan&&I.plan.items.filter(function(i){return i.key===key;})[0];if(!item||!item.booking_id)return;var r=await sb.from('bookings').select('*').eq('id',item.booking_id).maybeSingle();if(r.error||!r.data)return toast('Could not open this booking.',true);await openArchived(r.data.sheet_id,r.data.reg);var b=S.rows.filter(function(x){return x.id===item.booking_id;})[0];if(b)openPanel(b);}
  function autoSelected(P){return (P.items||[]).filter(function(i){return (i.status==='new'||i.status==='changed')&&S.bi.selected&&S.bi.selected[i.kind+'|'+i.ref];}).map(function(i){return i.kind+'|'+i.ref;});}
  function biCoverage(P){var reports=P.report||{},days={};['drops','picks'].forEach(function(k){var r=reports[k];Object.keys(r&&r.by_day||{}).forEach(function(d){(days[d]=days[d]||{})[k]=r.by_day[d];});});var keys=Object.keys(days).sort();return keys.length?'<details class="bi-diag bi-coverage"><summary>Date coverage · '+keys.length+' date(s)</summary><div class="bi-diagbody">'+keys.map(function(d){return '<p>'+esc(biDay(d)+': '+(days[d].drops||0)+' drops · '+(days[d].picks||0)+' picks')+'</p>';}).join('')+'<p>Counts use report calendar dates. Drops sheets use your day-end cutoff.</p></div></details>':'';}
  function autoResultHtml(R){var days=R.days||[];return '<section class="mi-result" role="status"><h3>Import complete</h3><p>'+days.reduce(function(n,d){return n+(d.added||0);},0)+' added · '+days.reduce(function(n,d){return n+(d.updated||0);},0)+' updated · '+(R.reviews||0)+' held for review</p><div class="row-actions">'+days.filter(function(d){return d.sheet_id;}).map(function(d){return '<button type="button" class="btn ghost small" data-importboard="'+esc(d.sheet_id)+'">View '+esc(d.kind.toUpperCase()+' '+biDay(d.day))+'</button>';}).join('')+'</div></section>';}
  function importGroups(list){var groups=[],map={};list.forEach(function(x){var key=x.run_id || (x.source ? x.at+'|'+x.by+'|'+x.source : 'single|'+x.id), g=map[key];if(!g){g={key:key,at:x.at,by:x.by,source:x.source,items:[]};map[key]=g;groups.push(g);}g.items.push(x);});return groups;}
  function importGroupHtml(g){var added=0,changed=0;g.items.forEach(function(x){added+=x.added||0;changed+=x.changed||0;});return '<details class="bi-run"><summary><span><b>'+esc(biStamp(g.at))+'</b> · '+esc(g.by||'')+'<small>'+esc(g.source==='auto'?'Auto import':g.source==='manual'?'Manual import':'Import')+' · '+g.items.length+' sheet(s)</small></span><span>'+esc(added||changed?added+' added · '+changed+' updated':'No changes')+'</span></summary><div class="bi-diagbody">'+g.items.map(function(x){return '<div class="bi-rr"><span class="bi-bd">'+esc(x.kind.toUpperCase()+' '+biDay(x.day))+'</span><span class="bi-res">'+esc(x.undone?'Undone':(x.added||x.changed)?x.added+' added · '+x.changed+' updated':'No changes')+'</span>'+(x.latest&&!x.undone&&(x.added||x.changed)?'<button type="button" class="link bi-undo" data-undoimport="'+esc(x.id)+'">Review undo</button>':'')+'</div>';}).join('')+'</div></details>';}
  function importHistoryHtml(){if(!S.recentImports)loadRecentImports();if(S.importHistory===undefined)loadImportHistory();var list=S.importHistory||[],q=S.bi.historyQ||'';function matches(x){var src=x.source&&typeof x.source==='object'?(x.source.auto?'auto':'manual'):x.source||'',date=x.at?new Date(x.at).toLocaleDateString('en-CA',{timeZone:TZ}):'';return (!S.bi.historyMethod||src===S.bi.historyMethod)&&(!S.bi.historyDay||date===S.bi.historyDay)&&(!q||JSON.stringify(x).toLowerCase().indexOf(q.toLowerCase())>=0);}return '<section class="mi-history"><h3>Import history</h3><div class="bi-filters"><select data-historymethod aria-label="Import method">'+[['','All methods'],['manual','Manual'],['auto','Auto']].map(function(x){return '<option value="'+x[0]+'"'+(S.bi.historyMethod===x[0]?' selected':'')+'>'+x[1]+'</option>';}).join('')+'</select><input type="date" data-historyday aria-label="Import date" value="'+esc(S.bi.historyDay||'')+'"><input id="biHistoryQ" type="search" class="bi-search" placeholder="Filename, reference or staff" aria-label="Search import history" value="'+esc(q)+'"><button type="button" class="btn ghost small" data-importlog>Activity log</button></div><p class="bi-hint">Recent sheets include undo where available. Reviewed runs retain filenames and booking changes.</p>'+importGroups((S.recentImports||[]).filter(matches)).map(importGroupHtml).join('')+list.filter(matches).map(function(x){return '<details class="bi-run"><summary><span><b>'+esc(biStamp(x.at))+'</b> · '+esc(x.by||'')+'<small>'+esc(((x.source||{}).files||[]).map(function(f){return f.name;}).join(' · ')||'Auto import')+'</small></span><span>'+esc((x.result.selected||0)+' selected')+'</span></summary><div class="bi-diagbody">'+(x.result.changes||[]).map(function(i){return '<p><b>'+esc(i.ref||'')+'</b> · '+esc(i.status==='new'?'New booking':(i.changes||[]).map(biChange).join(' · '))+'</p>';}).join('')+'</div></details>';}).join('')+(!list.length?'<p class="bi-hint">'+esc(S.importHistoryError||'No reviewed runs recorded yet.')+'</p>':'')+'</section>';}
  async function loadImportHistory(){S.importHistory=[];var r=await sb.rpc('reviewed_import_history');if(r.error)S.importHistoryError='Reviewed history is unavailable until the prepared database update is installed.';else S.importHistory=r.data||[];if(S.view==='import')render();}

  async function manualIncoming(key){var I=S.imp,item=I.plan&&I.plan.items.filter(function(i){return i.key===key;})[0];if(!item||!item.can_resolve||I.saving||I.checking)return;if(!confirm('Apply these booking corrections?\n\n'+item.ref+'\n'+item.changes.map(biChange).join('\n')+'\n\nRegistration and return corrections are saved with your name. Other updates remain for import.'))return;I.saving=true;render();try{var r=await sb.rpc('reviewed_import_resolve',{p_batches:I.batches,p_hash:I.plan.hash,p_key:key});if(r.error)throw new Error(r.error.message);I.saving=false;await checkManualImport();}catch(err){I.saving=false;I.error=err.message;render();}}
