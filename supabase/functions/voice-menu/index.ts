// Public provider webhook: disable platform JWT verification for this function only.
// handler.mjs authenticates the canonical URL + form using the provider signature.
import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {createVoiceHandler} from './handler.mjs';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
Deno.serve(createVoiceHandler({
 base:Deno.env.get('VOICE_WEBHOOK_URL')||'',account:Deno.env.get('TWILIO_ACCOUNT_SID')||'',secret:Deno.env.get('TWILIO_AUTH_TOKEN')||'',
 rpc:async(name:string,args:Record<string,unknown>)=>{const {data,error}=await db.rpc(name,args);if(error)throw error;return data;}
}));
