// Disposable in-memory SQL and fake Auth only. No external services or secrets.
import {testApi,apiOrigin} from './aero/checks/shared-test-api.mjs';
import {seedManager,id} from './aero/checks/shared-manager-fixture.mjs';
import {committed} from './aero/checks/shared-fixture.mjs';
import {randomUUID} from 'node:crypto';
export async function createBackend(config) {
 const instance=randomUUID();
 const api=await testApi({seed:async db=>{
  await seedManager(db);
  for(const c of [1,2]){
   await db.query('update companies set name=$1,slug=$2,brand=$3 where id=$4',['Synthetic '+c,'synthetic-'+c,JSON.stringify({attendance:true}),id(c)]);
   await db.query('update aero_companies set name=$1 where id=$2',['Synthetic '+c,id(c)]);
   await db.query('update aero_profiles set full_name=$1||right(id::text,2) where company_id=$2',['Synthetic person ',id(c)]);
   await db.query('insert into private.attendance_testers(company_id,user_id) values($1,$2) on conflict do nothing',[id(c),id(c*10+2)]);
   await db.query("insert into aero_shifts(id,company_id,user_id,worksite_id,clock_in_at,clock_out_at,note) values($1,$2,$3,$4,now()-interval '2 days',now()-interval '1 day 16 hours','Synthetic closed shift')",[id(350+c),id(c),id(c*10+2),id(100+c)]);
  }
 }});
 const accounts=[['staff-a',12],['manager-a',13],['staff-b',22],['manager-b',23]].map(([name,n])=>({name,id:id(n),email:name+'@staging.invalid',role:name.startsWith('manager')?'manager':'staff',company:n<20?'Synthetic 1':'Synthetic 2',password:config.password,pin:config.pin,link:'staging-'+name.padEnd(32,'x')}));
 const reply=(status,data)=>({status,data,headers:{'Cache-Control':'no-store','X-Synthetic-Instance':instance}});
 async function company(user){return (await committed(api.db,user,'select aero_current_company_id() id'))[0]?.id;}
 async function manager(user){return (await committed(api.db,user,'select aero_is_manager() ok'))[0]?.ok;}
 return {
  api,accounts,instance,
  async handle(path,method,headers,body={}){
   if(path==='/info')return reply(200,{mode:'synthetic-preview',instance,parking:config.parkingSha,aero:config.aeroSha,expires:config.expires,storage:'ephemeral-memory',outbound:'disabled',realPush:false});
   if(path==='/accounts')return reply(200,accounts);
   if(headers.apikey!=='staging-public-v1')return reply(401,{message:'Staging credentials required'});
   if(path.startsWith('/auth/v1/token')){
    if(body.grant_type==='refresh_token'||path.includes('grant_type=refresh_token'))return reply(401,{msg:'Synthetic session expired; sign in again'});
    const account=accounts.find(a=>a.email===body.email&&body.password===config.password);
    return account?reply(200,api.session(account.id)):reply(400,{msg:'Invalid synthetic credentials'});
   }
   if(path==='/functions/v1/staff-login'){
    const account=accounts.find(a=>a.link===body.token&&body.pin===config.pin);
    return account?reply(200,{token_hash:api.mint(account.id)}):reply(403,{error:'Invalid synthetic link or PIN'});
   }
   const user=api.userForToken((headers.authorization||'').replace(/^Bearer /i,''));
   if(!user&&!(path.startsWith('/auth/v1/verify')))return reply(401,{code:'PGRST301',message:'Synthetic session missing or backend restarted'});
   if(path==='/functions/v1/aero-access'){
    if(!await company(user)||!['staff','manager'].includes(body.target)||(body.target==='manager'&&!await manager(user)))return reply(403,{error:'Synthetic Attendance access denied'});
    return reply(200,{token_hash:api.mint(user)});
   }
   if(path.startsWith('/functions/'))return reply(404,{error:'No external function exists in synthetic staging'});
   if(path.startsWith('/storage/'))return reply(403,{message:'Storage is disabled in synthetic staging'});
   if(path.startsWith('/control/')){
    if(!await manager(user))return reply(403,{message:'Synthetic manager required'});
    const co=await company(user);if(!co)return reply(403,{message:'Test access disabled'});
    if(path==='/control/site'){
     if(!Number.isFinite(body.lat)||!Number.isFinite(body.lng)||Math.abs(body.lat)>90||Math.abs(body.lng)>180)return reply(400,{message:'Invalid test coordinates'});
     await api.db.query('update aero_worksites set lat=$1,lng=$2,radius_m=100 where company_id=$3',[body.lat,body.lng,co]);
     await api.db.query('update aero_companies set require_on_site=$1 where id=$2',[body.require_on_site===true,co]);
     return reply(200,{ok:true});
    }
    if(['/control/revoke','/control/restore'].includes(path)){
     const target=accounts.find(a=>a.id===body.user&&a.company===(user<id(20)?'Synthetic 1':'Synthetic 2'));
     if(!target||target.id===user)return reply(403,{message:'Choose another synthetic account in this tenant'});
     if(path==='/control/revoke')await api.db.query('delete from private.attendance_testers where company_id=$1 and user_id=$2',[co,target.id]);
     else await api.db.query('insert into private.attendance_testers(company_id,user_id) values($1,$2) on conflict do nothing',[co,target.id]);return reply(200,{ok:true});
    }
    return reply(404,{message:'Unknown synthetic control'});
   }
   if(path.startsWith('/rest/v1/rpc/')&&!path.startsWith('/rest/v1/rpc/aero_')){
    const fn=path.split('/').pop(),co=await company(user);
    if(!co)return reply(403,{message:'Synthetic account has no access'});
    const row=(await api.db.query('select * from staff where user_id=$1',[user])).rows[0];
    if(fn==='me')return reply(200,{...row,name:'Synthetic '+(await manager(user)?'manager':'staff'),role:await manager(user)?'owner':'office'});
    if(fn==='my_permissions')return reply(200,{note:true,clear:true,staff:!!await manager(user),settings:!!await manager(user)});
    if(['i_am_here','staff_seen','hand_archived_sheets','overstays','ops_push_device_status'].includes(fn))return reply(200,[]);
    return reply(404,{message:'Parking operation outside synthetic handoff scope'});
   }
   if(path.startsWith('/rest/v1/companies')){
    const co=await company(user);return reply(200,{id:co,name:'Synthetic '+(co===id(1)?'1':'2'),slug:'synthetic',brand:{attendance:true},yards:['TEST'],drops_day_end:'06:00:00'});
   }
   if(path.startsWith('/rest/v1/staff'))return reply(200,(await api.db.query('select * from staff where company_id=$1',[await company(user)])).rows.map(r=>({...r,name:'Synthetic person'})));
   if(['/sheets','/bookings','/activity','/alert_prefs'].some(x=>path.startsWith('/rest/v1'+x)))return reply(200,path.includes('/alert_prefs')?{}:[]);
   if(['/aero_current_company_id','/aero_is_manager'].some(x=>path.startsWith('/rest/v1/rpc'+x)))return reply(200,path.includes('is_manager')?!!await manager(user):await company(user));
   let output;
   const request={url:()=>apiOrigin+path,method:()=>method,postDataJSON:()=>body,headers:()=>headers};
   await api.route({request:()=>request,fulfill:async value=>{output=reply(value.status,typeof value.body==='string'?JSON.parse(value.body):null);}});
   return output;
  },
  close:()=>api.close()
 };
}
