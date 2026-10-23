import { check,sleep,TONIGHT,TOMORROW,iso,makeDb,phone,open,toast,noSideScroll,scenario,browser,fs } from '../harness.mjs';
function fixture(){
 const db=makeDb();db.company.brand={theme:'ops',colour:'#F9A01B',ink:'#172536',short:'TakeOff',lane_planner:true};
 db.laneData={can_move:true,can_manage:true,moves:[],lanes:[
  {id:'la',yard:'Y',name:'Lane A',capacity:5,access:'front',kind:'lane',revision:2},
  {id:'lb',yard:'Y',name:'Lane B',capacity:5,access:'both',kind:'lane',revision:3},
  {id:'hold',yard:'Y',name:'Holding',capacity:3,access:'open',kind:'holding',revision:0},
  {id:'temp',yard:'Y',name:'Moving spaces',capacity:2,access:'open',kind:'temporary',revision:0}],
 positions:[{booking_id:'c1',lane_id:'la',position:3,revision:1},{booking_id:'c2',lane_id:'la',position:5,revision:1},
 {booking_id:'c3',lane_id:'lb',position:2,revision:1},{booking_id:'c4',lane_id:'lb',position:3,revision:1},{booking_id:'c5',lane_id:'lb',position:4,revision:1}],
 cars:[['c1','AB12 CDE',TOMORROW,'10:00'],['c2','FG34 HIJ',TONIGHT,'12:00'],['c3','KL56 MNO',TONIGHT,'15:00'],['c4','PQ78 RST',TONIGHT,'16:00'],['c5','UV90 WXY',TOMORROW,'09:00'],['c6','YZ12 ABC',TONIGHT,'11:00']].map(([id,reg,day,time])=>({id,reg,ref:'REF-'+id,return_at:iso(day,time),yard:'Y',make:'Vehicle'}))};return db;
}
const enter=async page=>{await open(page);await page.locator('#menuBtn:visible,[data-bn="menuBtn"]:visible').first().click();await page.click('[data-view="lanes"]');await page.waitForSelector('.lp-lane');};
await scenario(async()=>{
 const db=fixture(),page=await phone(browser,db);await enter(page);
 check('lanes: physical order and capacity shown',await page.locator('.lp-lane').count()===4 && /2\/5/.test(await page.locator('.lp-lane').first().innerText()));
 check('lanes: yard shown by its board name',/^NB \/ Lane A/.test(await page.locator('.lp-lane h3').first().innerText()));
 check('lanes: earlier return behind later return flagged',/Return conflict/.test(await page.locator('.lp-lane').first().innerText()));
 await page.locator('.lp-lane [data-lpcar="c2"]').click();
 check('lanes: exact blocker listed and target cannot teleport',await page.locator('.lp-blockers [data-lpcar="c1"]').count()===1&&await page.locator('#lpMove').count()===0);
 check('lanes: independent moving space suggested',/Moving spaces \/ 1/.test(await page.locator('.lp-detail').innerText()));
 await page.locator('.lp-blockers [data-lpcar="c1"]').click();await page.selectOption('#lpDest','temp');await page.selectOption('#lpSlot','1');
 check('lanes: choosing a destination writes nothing',!db.calls.some(x=>x.fn==='lane_move'));
 await page.click('#lpMove button[type="submit"]');await sleep(250);
 check('lanes: explicit confirmation sends revisions',db.calls.some(x=>x.fn==='lane_move'&&x.args.p_booking==='c1'&&x.args.p_revision===1&&x.args.p_lane_revision===0));
 await page.locator('.lp-lane [data-lpcar="c2"]').click();check('lanes: removing blocker unlocks target',await page.locator('#lpMove').count()===1);
 await page.selectOption('#lpDest','hold');await page.selectOption('#lpSlot','2');db.laneWriteError='The destination changed. Refresh before confirming.';
 await page.click('#lpMove button[type="submit"]');await sleep(250);
 check('lanes: failed confirmation retains actual location',db.laneData.positions.find(x=>x.booking_id==='c2').lane_id==='la'&&/destination changed/.test(await toast(page)));
 delete db.laneWriteError;
 await page.fill('#lpQuery','FG34HIJ');check('lanes: registration search ignores spaces',await page.locator('.lp-lane').count()===1);
 await page.fill('#lpQuery','REF-c3');check('lanes: booking reference searchable',await page.locator('.lp-lane').count()===1);
 await page.fill('#lpQuery','');await page.locator('.lp-lane [data-lpcar="c4"]').click();
 check('lanes: two-ended lane chooses shortest blocker list',await page.locator('.lp-blockers li').count()===1);
 await page.setViewportSize({width:360,height:800});check('lanes: 360px screen has no side scroll',await noSideScroll(page),await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(x=>x.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(x=>({tag:x.tagName,cl:x.className,w:x.getBoundingClientRect().width,right:x.getBoundingClientRect().right}))));
 await page.evaluate(()=>scrollTo(0,0));await sleep(300);
 if(process.env.LANE_SHOTS){fs.mkdirSync(process.env.LANE_SHOTS,{recursive:true});await page.screenshot({path:process.env.LANE_SHOTS+'/lane-planner-phone.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:process.env.LANE_SHOTS+'/lane-planner-desktop.png',fullPage:true});}
 check('lanes: no browser errors',page.__errors.length===0,page.__errors);
},'lanes');
await scenario(async()=>{
 const db=fixture();db.laneData.can_move=false;db.laneData.can_manage=false;const page=await phone(browser,db);await enter(page);await page.locator('.lp-lane [data-lpcar="c1"]').click();
 check('lanes: read-only has no movement or setup forms',await page.locator('#lpMove,#lpAdd').count()===0);
},'lanes');
await scenario(async()=>{
 const db=fixture(),page=await phone(browser,db);await enter(page);await page.locator('summary').filter({hasText:'Add lane'}).click();
 await page.fill('#lpAdd [name="name"]','Overflow');await page.selectOption('#lpAdd [name="kind"]','holding');await page.fill('#lpAdd [name="capacity"]','4');await page.click('#lpAdd button');await sleep(250);
 const add=db.calls.find(x=>x.fn==='lane_save');check('lanes: holding area uses independent spaces',add?.args.p_access==='open'&&add.args.p_capacity===4&&await page.locator('.lp-lane').count()===5);
},'lanes');
await scenario(async()=>{
 const db=fixture();db.laneError='Could not find function lane_get';const page=await phone(browser,db);await open(page);await page.click('#menuBtn');await page.click('[data-view="lanes"]');await sleep(250);
 check('lanes: missing migration has clear recovery',/database part 104/.test(await page.locator('#main').innerText())&&await page.locator('[data-lpreload]').count()===1);
},'lanes');
await scenario(async()=>{
 const db=fixture(),page=await phone(browser,db);await enter(page);await page.locator('.lp-lane [data-lpcar="c1"]').click();await page.selectOption('#lpDest','hold');await page.selectOption('#lpSlot','1');
 await page.context().setOffline(true);await page.click('#lpMove button');await sleep(200);
 check('lanes: offline confirmation is refused without queueing a move',!db.calls.some(x=>x.fn==='lane_move')&&/Reconnect/.test(await toast(page)));
 await page.context().setOffline(false);
},'lanes');
for(const theme of ['','stdplus','cards','premium','board'])await scenario(async()=>{
 const db=fixture();db.company.brand.theme=theme;db.company.brand.lane_planner=true;const page=await phone(browser,db);
 if(['cards','premium','board'].includes(theme))await page.addInitScript(()=>localStorage.setItem('takeoff_mode','dark'));
 await enter(page);await page.locator('.lp-lane [data-lpcar="c1"]').click();
 check('lanes: '+(theme||'standard')+' look renders movement controls without errors',await page.locator('#lpMove').count()===1&&page.__errors.length===0);
 if(['cards','premium','board'].includes(theme)) check('lanes: '+theme+' dark selection stays dark',await page.locator('.lp-lane .lp-car.selected').first().evaluate(x=>getComputedStyle(x).backgroundColor)==='rgb(41, 61, 83)');
},'lanes');
await scenario(async()=>{
 // An add-on: a client without it never sees the Yard planner and never calls lane_get.
 for(const theme of ['ops','']){const db=fixture();db.company.brand={theme};const page=await phone(browser,db);await open(page);
  await page.locator('#menuBtn:visible,[data-bn="menuBtn"]:visible').first().click();await sleep(200);
  check('lanes add-on off ('+(theme||'standard')+'): no Yard planner in the menu',await page.locator('[data-view="lanes"]').count()===0);
  check('lanes add-on off ('+(theme||'standard')+'): the yard is never read',!db.calls.some(x=>x.fn==='lane_get'));}
},'lanes');
await scenario(async()=>{
 const db=fixture();db.laneError='The yard planner is not switched on for your company.';const page=await phone(browser,db);await enter(page).catch(()=>{});await sleep(250);
 check('lanes: switched off on the server says so',/not switched on/.test(await page.locator('#main').innerText()));
},'lanes');
