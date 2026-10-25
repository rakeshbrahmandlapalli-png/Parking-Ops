import {verifySignature,menu,route,fallback,unavailable,twiml} from './protocol.mjs';
const sidPattern=/^CA[0-9a-f]{32}$/i;
const xml=body=>new Response(body,{headers:{'Content-Type':'text/xml; charset=utf-8','Cache-Control':'no-store'}});
// Dependencies are injected so routing/security can be tested without a provider account.
export function createVoiceHandler({base,account,secret,rpc}) {
 return async req=>{
  if(req.method!=='POST') return new Response('POST only',{status:405});
  if(!base || !account || !secret) return new Response('Voice setup is incomplete',{status:503});
  const url=new URL(req.url), canonical=new URL(base);
  if(!(url.pathname===canonical.pathname||canonical.pathname.endsWith(url.pathname)&&url.pathname.length>1) || !/^https:$/.test(canonical.protocol) || canonical.search) return new Response('Invalid endpoint',{status:400});
  if(!req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return new Response('Form required',{status:415});
  const body=await req.text(); if(body.length>32768) return new Response('Too large',{status:413});
  const form=new URLSearchParams(body);
  if(!await verifySignature(base+url.search,form,secret,req.headers.get('x-twilio-signature')||'') || form.get('AccountSid')!==account) return new Response('Forbidden',{status:403});
  const step=url.searchParams.get('step')||'start';
  const parent=(step==='start'||step==='parent-status')?form.get('CallSid'):url.searchParams.get('sid');
  if(!parent || !sidPattern.test(parent)) return new Response('Invalid call',{status:400});
  // Signed child-status callbacks carry the real parent separately. Never trust a
  // status callback for one child/parent to update a different signed-query SID.
  if(step!=='start' && form.get('ParentCallSid') && form.get('ParentCallSid')!==parent) return new Response('Wrong parent',{status:403});
  if(step!=='start' && !form.get('ParentCallSid') && form.get('CallSid')!==parent) return new Response('Wrong call',{status:403});
  const run=(name,args)=>rpc(name,args);
  try {
   if(step==='start') {
    const cfg=await run('voice_call_begin',{p_account:account,p_to:form.get('To')||'',p_sid:parent,p_from:form.get('From')||''});
    if(!cfg) return xml(unavailable());
    if(cfg.menu_on) return xml(menu(base,parent,cfg.greeting,cfg.name));
    return xml(route(base,parent,await run('voice_call_route',{p_sid:parent})));
   }
   if(step==='choice') {
    const digit=form.get('Digits')||'';
    if(!['','0','1','2'].includes(digit)) {
     if(url.searchParams.get('attempt')!=='1') return xml(menu(base,parent,'','',1));
    }
    const result=await run('voice_call_choice',{p_sid:parent,p_digit:['0','1','2'].includes(digit)?digit:''});
    if(!result) return xml(unavailable());
    const target=await run('voice_call_route',{p_sid:parent});
    if(!target?.identity && !target?.fallback) await run('voice_call_status',{p_sid:parent,p_status:'missed'});
    return xml(route(base,parent,target,result.marked==='CALLED'||result.marked==='already'?"Thank you. We've notified the office.":''));
   }
   const secondsText=form.get(step==='dial-result'||step==='fallback-result'?'DialCallDuration':'CallDuration');
   const seconds=secondsText && /^\d{1,7}$/.test(secondsText)?Number(secondsText):null;
   if(step==='client-status') {
    const status=form.get('CallStatus');
    if(status==='in-progress'||status==='answered') await run('voice_call_status',{p_sid:parent,p_status:'answered'});
    else if(status==='completed') await run('voice_call_status',{p_sid:parent,p_status:'completed',p_seconds:seconds});
    return new Response(null,{status:204});
   }
   if(step==='parent-status') {
    if(['completed','canceled','failed','busy','no-answer'].includes(form.get('CallStatus'))) await run('voice_call_status',{p_sid:parent,p_status:'missed'});
    return new Response(null,{status:204});
   }
   if(step==='dial-result'||step==='fallback-result') {
    const answered=form.get('DialCallStatus')==='completed';
    const target=!answered && step==='dial-result'?await run('voice_call_route',{p_sid:parent}):null;
    await run('voice_call_status',{p_sid:parent,p_status:answered?'completed':'missed',p_seconds:seconds});
    if(answered) return xml(twiml('<Hangup/>'));
    if(step==='dial-result') {
     if(target?.fallback) return xml(fallback(base,parent,target.fallback));
    }
    return xml(unavailable());
   }
   return new Response('Unknown step',{status:400});
  } catch(_e) {
   // Fail closed with a 5xx so the configured provider fallback/retry can take over.
   // Never log signatures, access tokens, or a full caller payload.
   console.error('voice-menu backend failure');
   return new Response('Voice temporarily unavailable',{status:503});
  }
 };
}
