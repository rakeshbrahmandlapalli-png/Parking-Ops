// Staff endpoint: JWT + live staff permission + currently approved device.
import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {accessToken} from '../voice-menu/protocol.mjs';
const URL_=Deno.env.get('SUPABASE_URL')!;
const admin=createClient(URL_,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'';
 const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
 if(['https://takeoff-ops.vercel.app','https://parkingbay-ops.vercel.app'].includes(origin)) headers['Access-Control-Allow-Origin']=origin;
 const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method==='OPTIONS')return new Response('',{headers});
 if(req.method!=='POST')return reply(405,{message:'POST only.'});
 const caller=createClient(URL_,Deno.env.get('SUPABASE_ANON_KEY')!,{auth:{persistSession:false},global:{headers:{Authorization:req.headers.get('authorization')||''}}});
 const {data:me,error:meError}=await caller.rpc('me');
 const {data:allowed}=await caller.rpc('can',{p_action:'called'});
 if(meError||!me?.id||allowed!==true)return reply(403,{message:'Sign in with office access.'});
 let body;try{body=await req.json()}catch{return reply(400,{message:'Invalid request.'})}
 if(!body || typeof body!=='object' || typeof body.device!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.device))return reply(400,{message:'Invalid device.'});
 const args={p_company:me.company_id,p_staff:me.id,p_device:body.device};
 const {data:ctx,error}=await admin.rpc('voice_device_context',args);
 if(error)return reply(403,{message:'This company phone is not approved for voice calls.'});
 if(!ctx?.ready)return reply(409,{message:'Voice service setup and cost approval are required.'});
 const account=Deno.env.get('TWILIO_ACCOUNT_SID')||'',key=Deno.env.get('TWILIO_API_KEY_SID')||'',secret=Deno.env.get('TWILIO_API_KEY_SECRET')||'',push=Deno.env.get('TWILIO_PUSH_CREDENTIAL_SID')||'';
 if(account!==ctx.account||!/^AC[0-9a-f]{32}$/i.test(account)||!/^SK[0-9a-f]{32}$/i.test(key)||!secret||!/^CR[0-9a-f]{32}$/i.test(push))return reply(503,{message:'Voice provider credentials are not configured.'});
 if(body.action==='authorize')return reply(200,{ok:true,identity:ctx.identity});
 if(body.action==='token')return reply(200,{token:await accessToken(account,key,secret,push,ctx.identity),identity:ctx.identity,expires_in:600});
 if(body.action==='ready'||body.action==='offline'){
  const {data:updated,error:e}=await admin.rpc('voice_device_ready',{...args,p_registered:body.action==='ready'});
  return e||updated!==true?reply(503,{message:'Could not update voice registration.'}):reply(200,{ok:true});
 }
 return reply(400,{message:'Unknown voice action.'});
});
