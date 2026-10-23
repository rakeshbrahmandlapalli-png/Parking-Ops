// Real PostgreSQL rules on PGlite, using synthetic stays only.
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
const db=new PGlite(), id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
const scalar=async(sql,args=[])=>Object.values((await q(sql,args))[0])[0];
const call=(fn,args=[])=>scalar(`select ${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args);
let passed=0,failed=0;
const ok=(name,c)=>{console.log((c?'PASS ':'FAIL ')+name);c?passed++:failed++;};
const no=async(name,fn,re)=>{try{await fn();ok(name,false);}catch(e){ok(name,!re||re.test(e.message));if(re&&!re.test(e.message))console.log(e.message);}};
await db.exec(`create role anon;create role authenticated;create schema auth;create schema private;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create table companies(id uuid primary key,yards text[],brand jsonb default '{"lane_planner":true}');
create table staff(id uuid primary key,user_id uuid,company_id uuid,name text,role text,acting text,active boolean default true,extra text[] default '{}');
create table bookings(id uuid primary key,company_id uuid,kind text,reg text,ref text,drop_at timestamptz,return_at timestamptz,make text default '',yard text default 'Y',yard_before_t text default '',intake text default '',sent_at timestamptz,cleared_at timestamptz,removed_at timestamptz,updated_at timestamptz default now());
create table activity(id bigint generated always as identity,company_id uuid,at timestamptz default clock_timestamp(),reg text,action text,value text,staff_name text);
create function me() returns staff language sql stable security definer as $$select * from staff where user_id=auth.uid() and active$$;
create function my_company() returns uuid language sql stable security definer as $$select company_id from me()$$;
create function can(p text) returns boolean language sql stable security definer as $$select role<>'view' and not ('-'||p=any(extra)) from me()$$;
create function log_activity(b bookings,a text,v text) returns void language sql security definer as $$insert into activity(company_id,reg,action,value,staff_name) values(b.company_id,b.reg,a,v,coalesce(nullif((me()).acting,''),(me()).name))$$;`);
for(const n of [1,2])await q('insert into companies values($1,array[\'Y\',\'S\',\'T\'])',[id(n)]);
for(const [n,c,r]of [[11,1,'owner'],[12,1,'bongo'],[13,1,'view'],[21,2,'owner']])await q('insert into staff(id,user_id,company_id,name,role,acting)values($1,$1,$2,$3,$4,\'\')',[id(n),id(c),'Staff '+n,r]);
for(const [n,c,k,r,ref]of [[31,1,'picks','A11AAA','ONE'],[32,1,'drops','A11AAA','ONE'],[33,1,'drops','B22BBB','TWO'],[34,1,'drops','C33CCC','THREE'],[35,1,'drops','D44DDD','FOUR'],[41,2,'drops','Z99ZZZ','OTHER']])await q("insert into bookings(id,company_id,kind,reg,ref,drop_at,return_at,intake)values($1,$2,$3,$4,$5,'2026-10-20T10:00Z','2026-10-25T10:00Z','Collected')",[id(n),id(c),k,r,ref]);
const sql=fs.readFileSync(new URL('../setup/104-lane-planner.sql',import.meta.url),'utf8');
await db.exec(sql);await db.exec(sql);ok('setup applies twice',true);
const addon=fs.readFileSync(new URL('../setup/107-lane-planner-addon.sql',import.meta.url),'utf8');
await db.exec(addon);await db.exec(addon);ok('add-on part applies twice',true);
const user=async n=>q("select set_config('test.uid',$1,false)",[n?id(n):'']);
await user(11);
let d=await call('lane_get');ok('read starts empty and does not invent positions',d.positions.length===0&&d.lanes.length===0);
ok('arrival and return rows appear as one physical stay',d.cars.filter(x=>x.ref==='ONE').length===1);
const lane=await call('lane_save',['Y','Lane A',5,'front','lane']);
const hold=await call('lane_save',['Y','Holding',3,'open','holding']);
const both=await call('lane_save',['Y','Lane B',5,'both','lane']);
await no('terminal is not parking',()=>call('lane_save',['T','Invalid',1,'front','lane']),/parking yard/);
await no('invalid kind and access refused',()=>call('lane_save',['Y','Invalid',1,'front','holding']),/details/);
await no('duplicate lane refused',()=>call('lane_save',['Y','Lane A',5,'front','lane']),/unique/);
await no('out-of-range capacity refused',()=>call('lane_save',['Y','Invalid',0,'front','lane']),/details/);
let move=(b,l,pos,rev,lrev)=>call('lane_move',[id(b),l,pos,rev,lrev]);
d=await move(31,lane.id,5,0,0);ok('first placement records exact space and revision',d.positions[0].position===5&&d.positions[0].revision===1);
await no('linked return cannot get a second location',()=>move(32,hold.id,1,0,0),/tracked vehicle/);
await no('stale destination rejected',()=>move(33,lane.id,4,0,0),/destination changed/);
d=await move(33,lane.id,4,0,1);
await no('occupied position refused',()=>move(34,lane.id,4,0,2),/occupied/);
await no('a gap behind a car is not reachable',()=>move(34,lane.id,5,0,2),/occupied/);
await no('blocked source cannot leave',()=>move(31,hold.id,1,1,0),/blocking cars/);
await no('same-lane reshuffle cannot bypass blockers',()=>move(33,lane.id,3,1,2),/holding space/);
await no('out-of-range position refused',()=>move(34,lane.id,6,0,2),/valid position/);
d=await move(33,hold.id,3,1,0);ok('holding spaces are independently accessible',d.positions.find(x=>x.booking_id===id(33)).position===3);
await no('old car revision cannot move it twice',()=>move(33,lane.id,4,1,3),/car moved/);
d=await move(31,hold.id,1,1,1);ok('target becomes movable after blocker relocated',d.positions.find(x=>x.booking_id===id(31)).lane_id===hold.id);
await q("update bookings set return_at='2026-10-22T12:00Z',updated_at=clock_timestamp() where id=$1",[id(32)]);
d=await call('lane_get');ok('changed return time reaches tracked arrival',d.cars.find(x=>x.id===id(31)).return_at.startsWith('2026-10-22'));
await move(34,both.id,2,0,0);await move(35,both.id,4,0,1);
d=await move(35,hold.id,2,1,2);ok('two-ended lane allows rear exit despite front blocker',d.positions.find(x=>x.booking_id===id(35)).lane_id===hold.id);
await no('anonymous RPC rejected',async()=>{await user(null);return call('lane_get');},/Sign in/);
await user(13);d=await call('lane_get');ok('view-only gets read access without controls',!d.can_move&&!d.can_manage);
await no('view-only cannot move',()=>move(31,null,null,2,null),/cannot move/);
await user(12);await no('driver cannot create lanes',()=>call('lane_save',['Y','Driver lane',2,'front','lane']),/manager/);
d=await move(34,null,null,1,null);ok('confirmed departure clears occupancy but retains revision',d.positions.find(x=>x.booking_id===id(34)).lane_id===null);
await user(21);d=await call('lane_get');ok('another company sees no positions or lanes',d.positions.length===0&&d.lanes.length===0);
await no('other company cannot move a vehicle',()=>move(31,null,null,2,null),/not on your board/);
await no('other company cannot use a lane',()=>move(41,lane.id,1,0,3),/your yard/);
await db.exec('set role authenticated');ok('RLS hides other company positions',(await q('select * from parking_positions')).length===0);
await no('direct writes refused',()=>q('update parking_lanes set capacity=100'),/permission denied/);await db.exec('reset role');
ok('anonymous has no execute privilege',!(await scalar("select has_function_privilege('anon','public.lane_move(uuid,uuid,integer,integer,integer)','execute')")));
ok('authenticated cannot invoke internal matching helper',!(await scalar("select has_function_privilege('authenticated','private.lane_same_stay(bookings,bookings)','execute')")));
await user(11);await q('update staff set acting=\'RAKESH.O\' where id=$1',[id(11)]);
d=await move(35,lane.id,5,2,4);ok('confirmed movement retains acting staff name',d.positions.find(x=>x.booking_id===id(35)).moved_by_name==='RAKESH.O');
ok('moves logged for handover',d.moves.length>=6);
const gap=await call('lane_save',['Y','Access test',4,'front','lane']);
for(const n of [36,37])await q("insert into bookings(id,company_id,kind,reg,ref,drop_at,return_at)values($1,$2,'drops',$3,$3,'2026-10-20T10:00Z','2026-10-25T10:00Z')",[id(n),id(1),'TEST'+n]);
await move(36,gap.id,1,0,0);
await no('empty deeper gap behind occupied front is unreachable',()=>move(37,gap.id,3,0,1),/block access/);
await db.exec('set role authenticated');d=await call('lane_get');ok('signed-in staff RPC reads own company',d.lanes.length===4);await db.exec('reset role');
await q("update staff set extra=array['-yard','-intake'] where id=$1",[id(11)]);
await no('movement permission overrides respected',()=>move(36,null,null,1,null),/cannot move/);
await q("update staff set extra='{}',active=false where id=$1",[id(11)]);
await no('disabled staff cannot read yard',()=>call('lane_get'),/Sign in/);
await q("update staff set active=true where id=$1",[id(11)]);
await q("update bookings set cleared_at=now() where id=$1",[id(36)]);
d=await call('lane_get');ok('board completion never silently releases a physical slot',d.positions.find(x=>x.booking_id===id(36)).lane_id===gap.id&&!!d.cars.find(x=>x.id===id(36)).cleared_at);
await no('ended booking cannot move to another parking space',()=>move(36,hold.id,2,1,4),/booking has ended/);
const pos=d.positions.find(x=>x.booking_id===id(36));await move(36,null,null,pos.revision,null);ok('ended booking can explicitly confirm departure',true);
// Pairing and which unplaced cars show (live data has thousands of old PICKS rows).
for(const [n,k,r,ref,drop,ret,extra]of [
  [51,'picks','E55EEE','FIVE','2026-10-20T10:00Z','2026-10-25T10:00Z',''],
  [52,'drops','E55EEE','FIVE','2026-10-20T11:30Z','2026-10-25T10:00Z',''],
  [53,'picks','E55EEE','SIX','2026-10-21T10:00Z','2026-10-26T10:00Z',''],
  [54,'picks','F66FFF','OLD','2026-01-01T10:00Z','2026-01-05T10:00Z',''],
  [55,'picks','G77GGG','GONE','2026-10-19T10:00Z','2026-10-21T10:00Z',''],
  [56,'drops','G77GGG','GONE','2026-10-19T10:00Z','2026-10-21T10:00Z','sent']])
  await q(`insert into bookings(id,company_id,kind,reg,ref,drop_at,return_at,intake,sent_at)values($1,$2,$3,$4,$5,$6,$7,'Collected',${extra?'now()':'null'})`,[id(n),id(1),k,r,ref,drop,ret]);
await q("update bookings set return_at=now()+interval '3 days' where id in ($1,$2,$3,$4)",[id(51),id(52),id(53),id(55)]);
await q("update bookings set yard=case when id=$1 then '' else 'S' end where id in ($1,$2)",[id(51),id(52)]);
d=await call('lane_get');
ok('same ref with a different drop time is one stay',d.cars.filter(x=>x.ref==='FIVE').length===1);
ok('a repeat visit by the same registration stays separate',d.cars.filter(x=>x.reg==='E55EEE').length===2);
ok('a PICKS car with no location shows its DROPS car yard',d.cars.find(x=>x.ref==='FIVE').yard==='S');
ok('old PICKS history is not listed as parked',!d.cars.some(x=>x.ref==='OLD'));
ok('a car whose DROPS car was SENT is not listed unplaced',!d.cars.some(x=>x.ref==='GONE'));
// Part 107: a client without the add-on is refused everywhere; data comes back when switched on.
await user(11);await q("update companies set brand='{}' where id=$1",[id(1)]);
await no('add-on off: reading refused',()=>call('lane_get'),/not switched on/);
await no('add-on off: adding an area refused',()=>call('lane_save',['Y','Off lane',2,'front','lane']),/not switched on/);
await no('add-on off: moving refused',()=>move(36,null,null,9,null),/not switched on/);
await q("update companies set brand='{\"lane_planner\":true}' where id=$1",[id(1)]);
d=await call('lane_get');ok('add-on back on: lanes kept',d.lanes.length===4);
await db.close();console.log(`${passed} passed, ${failed} failed`);process.exitCode=failed?1:0;
