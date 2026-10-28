// Part 130: import_sheet snapshots only the cars a sheet can touch (28 Oct timeout).
// Runs the same imports through part 53's import_sheet and part 130's on throwaway
// Postgres and checks they record the same undo (added / changed) and leave the same
// bookings, that undo still works, and that a sheet no longer costs more as history grows.
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
let passed=0;const check=(name,good)=>{assert.ok(good,name);console.log('PASS '+name);passed++;};
const fn=(sql,name)=>sql.slice(sql.indexOf('create or replace function '+name+'(')).match(/^[\s\S]*?\n\$\$;/)[0];

async function makeDb(part){
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;create table auth.users(id uuid primary key);create table cur(id uuid);create table pt_links(booking_id uuid);`);
  const base=read('setup/01-core.sql');
  for(const t of ['companies','staff','sheets','bookings','activity'])await db.exec(base.match(new RegExp('create table if not exists '+t+' \\([\\s\\S]*?\\n\\);'))[0]);
  await db.exec(`alter table bookings add column if not exists num int,add column if not exists early boolean default false,add column if not exists early_at timestamptz,add column if not exists removed_at timestamptz,add column if not exists orig_return_at timestamptz,add column if not exists sched_at timestamptz,add column if not exists est_at timestamptz,add column if not exists flight_note text default '',add column if not exists moved_from uuid,add column if not exists pick_called text default '',add column if not exists pick_called_at timestamptz,add column if not exists pt_at timestamptz,add column if not exists intake_at timestamptz,add column if not exists charge_at timestamptz,add column if not exists charge_agreed numeric;
  create function me() returns staff language sql stable security definer set search_path=public as $$select s from staff s join cur on cur.id=s.id where s.active$$;
  create function my_company() returns uuid language sql stable as $$select (me()).company_id$$;
  create function can(a text) returns boolean language sql stable security definer set search_path=public as $$select coalesce((select role in ('owner','manager','office') from me()),false)$$;
  create function drops_day_of(t timestamptz,c companies) returns date language sql as $$select (t at time zone c.time_zone)::date-case when (t at time zone c.time_zone)::time<=c.drops_day_end then 1 else 0 end$$;`);
  const undo=read('setup/44-undo-import.sql');
  await db.exec(undo.match(/create table if not exists private.imports \([\s\S]*?\n\);/)[0]);
  await db.exec(fn(undo,'undo_import'));
  const p92=read('setup/92-reg-change-reaches-other-row.sql');await db.exec(p92.slice(p92.indexOf('create or replace function import_sheet_core')));
  const p53=read('setup/53-import-skip-unchanged.sql');await db.exec(p53.split('-- The DROPS day')[0]);
  // The live indexes (01-core and later parts), so the import itself runs as it does live.
  await db.exec(`create index on bookings(sheet_id);create index on bookings(company_id,kind,ref);create index on bookings(company_id) where kind='drops' and cleared_at is null;create index on bookings(moved_from) where moved_from is not null;create index on activity(booking_id) where booking_id is not null;create unique index on sheets(company_id,kind,day);`);
  if(part===130){const sql=read('setup/130-import-snapshot-scope.sql');await db.exec(sql);await db.exec(sql);}
  await db.exec(`insert into companies(name,slug) values('TakeOff','takeoff'),('Other','other');insert into staff(company_id,name,role) select id,'Office','office' from companies;insert into cur select s.id from staff s join companies c on c.id=s.company_id where c.slug='takeoff';`);
  return db;
}
const imp=async(db,kind,day,rows)=>(await db.query('select import_sheet($1,$2,$3) r',[kind,day,JSON.stringify(rows)])).rows[0].r;
const row=(ref,reg,ret,extra={})=>({ref,reg,name:'EXAMPLE '+ref,drop_local:'2026-10-18 08:00',return_local:ret,flight:'U2'+ref.length,...extra});
// Same imports, both versions: undo records by ref, and the bookings left.
async function scenario(db){
  await imp(db,'drops','2026-10-20',[row('RA','AA11AAA','2026-10-20 19:00'),row('','XX11 XXX','2026-10-20 20:00'),row('RC','CC11CCC','2026-10-20 21:00')]);
  await imp(db,'drops','2026-10-28',[row('RE','EE11EEE','2026-10-28 18:00')]);
  await imp(db,'picks','2026-10-28',[row('RP','PP11PPP','2026-11-02 10:00')]);
  const r=await imp(db,'drops','2026-10-28',[
    row('RA','AA11AAA','2026-10-28 19:00'),          // moved here from the 20th by reference
    row('','XX11XXX','2026-10-28 20:00'),            // moved here by registration (no reference)
    row('RE','EE11EEE','2026-10-28 18:30',{name:'CHANGED'}), // already on this sheet, changed
    row('RN','NN11NNN','2026-10-28 22:00')]);        // new
  const p=await imp(db,'picks','2026-10-28',[row('RP','PP11PPP','2026-11-02 10:00'),row('RQ','QQ11QQQ','2026-11-03 10:00')]);
  const refOf=async id=>(await db.query('select coalesce(nullif(ref,\'\'),reg) r from bookings where id=$1',[id])).rows[0].r;
  const rec=async undoId=>{const i=(await db.query('select added,changed from private.imports where id=$1',[undoId])).rows[0];
    return {added:(await Promise.all(i.added.map(refOf))).sort(),changed:i.changed.map(c=>({ref:c.after.ref||c.after.reg,before:c.before,after:c.after})).sort((a,b)=>a.ref<b.ref?-1:1)};};
  const strip=o=>JSON.parse(JSON.stringify(o,(k,v)=>['id','sheet_id','company_id','created_at','orig_return_at','called_at','pick_called_at','by_name'].includes(k)?undefined:v));
  const drops=strip(await rec(r.undo_id)),picks=strip(await rec(p.undo_id));
  const left=(await db.query(`select b.kind,s.day::text,b.ref,b.reg,b.name,b.return_at::text,b.num from bookings b join sheets s on s.id=b.sheet_id order by 1,2,3,4`)).rows;
  return {drops,picks,left,undoDrops:r.undo_id,undoPicks:p.undo_id};
}
const before=await makeDb(53),after=await makeDb(130);
const a=await scenario(before),b=await scenario(after);
check('DROPS import: same cars added (new one only)',JSON.stringify(a.drops.added)===JSON.stringify(b.drops.added)&&b.drops.added.join()==='RN');
check('DROPS import: same cars changed, same before/after (moved by ref, moved by reg, updated)',JSON.stringify(a.drops.changed)===JSON.stringify(b.drops.changed)&&b.drops.changed.length===3);
check('PICKS import: same undo record',JSON.stringify(a.picks)===JSON.stringify(b.picks)&&b.picks.added.join()==='RQ');
check('bookings left exactly the same',JSON.stringify(a.left)===JSON.stringify(b.left));
await after.query('select undo_import($1)',[b.undoPicks]);await after.query('select undo_import($1)',[b.undoDrops]);
const back=(await after.query(`select s.day::text as day,b.ref,b.reg,b.name from bookings b join sheets s on s.id=b.sheet_id where b.kind='drops' order by 1,2,3`)).rows;
check('undo puts the moved cars back on the 20th and takes the new car off',back.filter(x=>x.day==='2026-10-20').length===3&&!back.some(x=>x.ref==='RN')&&back.find(x=>x.ref==='RE').name==='EXAMPLE RE');
check('undo takes the new PICKS car off',!(await after.query(`select 1 from bookings where ref='RQ'`)).rows.length);

// History: ~4,100 old cars. The before/after copy around each sheet (import_sheet's own
// time, not the import itself) should no longer grow with it.
async function timed(part,history){
  const db=await makeDb(part);
  if(history)await db.exec(`insert into sheets(company_id,kind,day) select c.id,k,d::date from companies c,unnest(array['drops','picks']) k,generate_series('2026-06-01'::date,'2026-09-30','1 day') d where c.slug='takeoff';
    insert into bookings(company_id,sheet_id,kind,ref,reg,name,return_at,drop_at,num,cleared_at) select s.company_id,s.id,s.kind,'H'||s.kind||s.day||'-'||n,'HX'||n||'ABC','OLD',s.day+time '19:00',s.day-2,n,now() from sheets s,generate_series(1,17) n where s.day<'2026-10-01';`);
  await db.exec(`set track_functions='all'`);
  const t=performance.now();
  for(let d=0;d<8;d++){const day=new Date(Date.UTC(2026,10,1+d)).toISOString().slice(0,10);
    await imp(db,'drops',day,Array.from({length:23},(_,i)=>row('T'+d+'D'+i,'TD'+d+i+'XYZ',day+' 19:00')));
    await imp(db,'picks',day,Array.from({length:23},(_,i)=>row('T'+d+'P'+i,'TP'+d+i+'XYZ',day+' 19:00',{drop_local:day+' 06:00'})));}
  const total=performance.now()-t;
  await new Promise(r=>setTimeout(r,600));
  const own=+(await db.query(`select self_time from pg_stat_user_functions where funcname='import_sheet'`)).rows[0].self_time;
  return {total,own};
}
const old=await timed(53,true),empty=await timed(130,false),hist=await timed(130,true);
const ms=x=>x.toFixed(0)+' ms';
console.log(`16 sheets, 368 bookings, ~4,100 old cars: part 53 ${ms(old.total)} (copy ${ms(old.own)}), part 130 ${ms(hist.total)} (copy ${ms(hist.own)}); part 130 with no history ${ms(empty.total)} (copy ${ms(empty.own)})`);
check('with history, part 130 copies far less than part 53',hist.own*5<old.own);
check('with history, the whole import is faster',hist.total<old.total);
check('part 130 copy time barely changes with history',hist.own<empty.own*3+20);
console.log(passed+' passed');
