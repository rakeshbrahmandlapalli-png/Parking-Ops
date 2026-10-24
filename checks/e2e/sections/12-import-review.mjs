import {browser,scenario,phone,open,makeDb,biDb,check,sleep,TONIGHT,addDays,fs,path} from '../harness.mjs';
const visit=async(page)=>{await open(page);await page.evaluate(()=>(document.querySelector('#bnav [data-bn=menuBtn]')||document.getElementById('menuBtn')).click());await page.waitForSelector('#menu[open]');await page.click('#menu [data-view="import"]');await sleep(400);};
const files=()=>[1,2].map((n)=>({name:'Bookings-'+n+'.xls',mimeType:'application/vnd.ms-excel',buffer:Buffer.from('Reference\tCar Reg\tClient\tBooking From\tDrop off Time\tBooking To\tCollection Time\nNEW'+n+'\tAB2'+n+'CDE\tExample '+n+'\t'+TONIGHT+'\t0'+(7+n)+':30\t'+addDays(TONIGHT,2)+'\t1'+n+':00')}));
for(const width of [360,390,1024,1440]) await scenario(async()=>{
 const db=biDb('ops');db.preview.selection_supported=true;
 const page=await phone(browser,db,{width});await visit(page);await page.click('[data-autopreview]');await page.waitForSelector('[data-biselect]');
 const boxes=page.locator('[data-biselect]'),n=await boxes.count();check('auto '+width+': ready bookings have checked selection boxes',n>0&&await boxes.first().isChecked());
 await boxes.first().uncheck();const excluded=await boxes.first().getAttribute('data-biselect');
 await page.click('[data-autorun]');await sleep(600);const sent=db.autoRuns.find(x=>x.action==='apply');check('auto '+width+': unchecked bookings are excluded from request',sent&&sent.selected.length===n-1&&!sent.selected.includes(excluded)&&sent.expect_hash===db.preview.hash);
 await page.click('[data-bitab="manual"]');await page.click('[data-impkind="picks"]');await page.setInputFiles('[data-file="excel"]',files());await page.click('[data-read]');await page.waitForSelector('[data-manualselect]');
 check('manual '+width+': two files detected and reviewed',await page.locator('.mi-file').count()===2&&await page.locator('[data-manualselect]').count()===2);
 check('manual '+width+': checking files performs no import',!db.calls.some(c=>c.fn==='reviewed_import_apply'));
 await page.fill('#miQ','NEW1');check('manual '+width+': searching filters rows without changing selection',await page.locator('.mi-row:not([hidden])').count()===1);
 await page.fill('#miQ','');await page.locator('[data-manualselect]').nth(1).uncheck();
 check('manual '+width+': button names the selected count',/Import 1 selected/.test(await page.locator('[data-create]').innerText()));
 check('manual '+width+': no document overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(e=>[e.tagName,e.className,e.getBoundingClientRect().right])));
 if(process.env.IMPORT_SHOTS){fs.mkdirSync(process.env.IMPORT_SHOTS,{recursive:true});await page.evaluate(()=>{window.scrollTo(0,0);document.querySelectorAll('.toast').forEach(t=>t.remove());});await page.screenshot({path:path.join(process.env.IMPORT_SHOTS,'manual-review-'+width+'.png'),fullPage:true});}
 await page.click('[data-create]');await page.waitForSelector('.mi-result');
 const apply=db.calls.find(c=>c.fn==='reviewed_import_apply');check('manual '+width+': only selected keys and checked hash are sent',apply.args.p_selected.length===1&&apply.args.p_hash==='manual-hash'&&!!apply.args.p_request);
 check('manual '+width+': completion provides a board link',await page.locator('[data-importboard]').count()===1);
 check('imports '+width+': no browser errors',page.__errors.length===0,page.__errors);
});
await scenario(async()=>{
 const db=biDb('ops');const page=await phone(browser,db,{width:390});await visit(page);await page.click('[data-bipreset="7"]');await page.click('[data-autopreview]');await sleep(600);const sent=db.autoRuns[0];check('date preset sends seven days',sent.to===addDays(sent.from,6));
 await page.click('[data-bitab="manual"]');await page.click('[data-impkind="picks"]');db.manualStatus={NEW1:{status:'review',reason:'Office edit conflicts',changes:[{field:'reg',from:'ZZ99ZZZ',to:'AB21CDE'}]},NEW2:{status:'invalid',reason:'Missing registration'}};
 await page.setInputFiles('[data-file="excel"]',files());await page.click('[data-read]');await page.waitForSelector('.mi-row');
 check('held and invalid rows cannot be selected',await page.locator('[data-manualselect]:disabled').count()===2&&await page.locator('[data-create]').isDisabled());
 check('conflict shows both values',/ZZ99ZZZ.*AB21CDE/.test(await page.locator('.mi-rows').innerText()));
 db.manualStatus={};await page.click('[data-manualcheck]');await page.waitForSelector('[data-manualselect]:checked');db.manualApplyError='Database busy. Nothing was imported.';
 await page.click('[data-create]');await page.waitForSelector('.alert');const first=db.calls.filter(c=>c.fn==='reviewed_import_apply').at(-1);
 check('failed import keeps the selected rows and offers retry',/Retry 2 selected/.test(await page.locator('[data-create]').innerText())&&await page.locator('[data-manualselect]:checked').count()===2);
 db.manualApplyError=null;await page.click('[data-create]');await page.waitForSelector('.mi-result');const second=db.calls.filter(c=>c.fn==='reviewed_import_apply').at(-1);check('retry retains idempotency request ID',first.args.p_request===second.args.p_request);
});
await scenario(async()=>{
 const db=makeDb(),page=await phone(browser,db,{width:390});await visit(page);check('manual-only company has no Auto tab',await page.locator('[data-bitab="auto"]').count()===0);await page.click('[data-bitab="history"]');check('manual-only company can open history',await page.locator('.mi-history').count()===1);await page.click('[data-bitab="manual"]');
 await page.click('[data-impkind="picks"]');db.manualPreviewError='reviewed_import_preview is not installed';await page.setInputFiles('[data-file="excel"]',files());await page.click('[data-read]');await page.waitForSelector('.alert');check('missing migration blocks imports with a clear message',/prepared database update/.test(await page.locator('.alert').innerText())&&await page.locator('[data-create]').count()===0&&!db.calls.some(c=>c.fn==='import_sheet'));
});
await scenario(async()=>{
 const db=biDb('ops'),page=await phone(browser,db,{width:1440});await visit(page);check('recent imports limited to three grouped runs',await page.locator('.bi-recent>.bi-run').count()===3);check('undo is inside run details',!(await page.locator('.bi-recent [data-undoimport]').first().isVisible()));await page.locator('.bi-recent>.bi-run').first().locator('summary').click();check('expanding a run reveals undo review',await page.locator('.bi-recent [data-undoimport]').first().isVisible());await page.click('[data-bitab="history"]');check('history exposes activity log and full recent runs',await page.locator('[data-importlog]').count()===1&&await page.locator('.mi-history>.bi-run').count()===4);
});

for(const theme of ['ops-refined','stdplus','premium',''])await scenario(async()=>{
 const db=biDb(theme),page=await phone(browser,db,{width:390});await visit(page);await page.click('[data-bitab="manual"]');await page.click('[data-impkind="picks"]');await page.setInputFiles('[data-file="excel"]',files());await page.click('[data-read]');await page.waitForSelector('[data-manualselect]');
 check('manual look '+(theme||'standard')+': no sideways scrolling',await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));check('manual look '+(theme||'standard')+': file list is collapsible on a phone',await page.locator('details.mi-files').count()===1&&!(await page.locator('details.mi-files').evaluate(e=>e.open)));check('manual look '+(theme||'standard')+': no browser errors',page.__errors.length===0,page.__errors);
});
await scenario(async()=>{
 const db=biDb('ops'),page=await phone(browser,db,{width:390});db.manualStatus={NEW1:{status:'review',can_resolve:true,booking_id:'b1',reason:'Office edits conflict',changes:[{field:'reg',from:'ZZ99ZZZ',to:'AB21CDE'}]}};await visit(page);await page.click('[data-bitab="manual"]');await page.click('[data-impkind="picks"]');await page.setInputFiles('[data-file="excel"]',files());await page.click('[data-read]');await page.waitForSelector('[data-manualincoming]');await page.click('[data-manualincoming]');await sleep(500);check('manual conflict: accepting incoming values sends checked hash and key',db.calls.some(c=>c.fn==='reviewed_import_resolve'&&c.args.p_hash==='manual-hash'&&!!c.args.p_key));check('manual conflict: resolution is followed by a new preview',db.calls.filter(c=>c.fn==='reviewed_import_preview').length>=2);
 await page.click('[data-bitab="history"]');await page.selectOption('[data-historymethod]','manual');check('history method filter excludes auto runs',!/Auto import/.test(await page.locator('.mi-history').innerText()));check('history fits on a phone',await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
});
// 24 Oct: in Operations the chosen date shortcut was navy text on a dark button. Every look: readable.
for(const theme of ['','stdplus','ops','ops-refined','premium','board','cards','pro']) await scenario(async()=>{
 for(const width of [390,1440]){
  const page=await phone(browser,biDb(theme),{width});await visit(page);await page.waitForSelector('[data-bipreset][aria-pressed=true]');
  const c=await page.evaluate(()=>{const b=document.querySelector('[data-bipreset][aria-pressed=true]'),s=getComputedStyle(b);const lum=(v)=>{const [r,g,bl]=v.match(/\d+(\.\d+)?/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4);});return 0.2126*r+0.7152*g+0.0722*bl;};const a=lum(s.color),z=lum(s.backgroundColor);return {ratio:(Math.max(a,z)+0.05)/(Math.min(a,z)+0.05),color:s.color,bg:s.backgroundColor};});
  check('import '+(theme||'standard')+' '+width+': chosen date shortcut is readable',c.ratio>=4.5,c);
  await page.close();
 }
});
// 24 Oct: the site dropped the connection during Import. The page said "Check failed" over a check that had worked.
await scenario(async()=>{
 const db=biDb('ops');db.preview.selection_supported=true;const page=await phone(browser,db,{width:390});await visit(page);
 await page.click('[data-autopreview]');await page.waitForSelector('[data-biselect]');
 db.applyError='The booking site dropped the connection (arrival_report_parkandride.php). Nothing was imported. Try again in a minute.';
 await page.click('[data-autorun]');await page.waitForSelector('[data-autokept]');
 check('failed import is called an import failure, not a check failure',/Import failed/.test(await page.locator('.bi-conn').innerText()));
 check('failed import says nothing was imported and keeps the check',/Nothing was imported/.test(await page.locator('[data-autokept]').innerText())&&await page.locator('[data-biselect]').count()>0);
 check('failed import can be tried again',await page.locator('[data-autorun]').isEnabled());
 db.applyError=null;db.previewError='The booking site didn\'t answer.';await page.click('[data-autopreview]');await page.waitForSelector('.bi-conn.bad');
 check('failed check is still a check failure and shows no old check',/Check failed/.test(await page.locator('.bi-conn').innerText())&&await page.locator('[data-biselect]').count()===0&&await page.locator('[data-autorun]').isDisabled());
 await page.close();
});
