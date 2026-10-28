import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return reply(405,{error:'POST only.'});
 const bearer=req.headers.get('authorization')||'';
 const url=Deno.env.get('SUPABASE_URL')!;
 const caller=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{auth:{persistSession:false},global:{headers:{Authorization:bearer}}});
 const {data:auth,error:authError}=await caller.auth.getUser();
 if(authError||!auth.user)return reply(401,{error:'Sign in again.'});
 const {data:company,error:accessError}=await caller.rpc('aero_current_company_id');
 if(accessError||!company)return reply(403,{error:'Attendance is not available for this account.'});
 let body;try{body=await req.json();}catch{return reply(400,{error:'Bad request.'});}
 const manager=body.target==='manager';
 if(manager){const {data:allowed}=await caller.rpc('aero_is_manager');if(!allowed)return reply(403,{error:'Attendance manager access required.'});}
 if(!auth.user.email)return reply(400,{error:'This account has no sign-in address.'});
 const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 const {data,error}=await admin.auth.admin.generateLink({type:'magiclink',email:auth.user.email});
 if(error||!data.properties?.hashed_token)return reply(500,{error:'Could not open Attendance. Try again.'});
 return reply(200,{token_hash:data.properties.hashed_token});
});
