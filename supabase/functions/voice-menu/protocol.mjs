// Provider-independent, deterministic protocol helpers. No network side effects.
export const xmlEscape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export const twiml = body => '<?xml version="1.0" encoding="UTF-8"?><Response>'+body+'</Response>';
const say = text => '<Say language="en-GB">'+xmlEscape(text)+'</Say>';
export const unavailable = () => twiml(say('The office is currently unavailable. Please try again shortly.')+'<Hangup/>');
export function callbackUrl(base,step,sid='',attempt=0) {
 const url=new URL(base); url.searchParams.set('step',step);
 if(sid) url.searchParams.set('sid',sid);
 if(attempt) url.searchParams.set('attempt',String(attempt));
 return url.toString();
}
export function menu(base,sid,greeting,company,attempt=0) {
 const welcome=greeting?.trim() || `Thank you for calling ${company || 'the parking office'}.`;
 const words=welcome+' Press 1 if you have landed. Press 2 if you are on your way to drop off your car. Press 0 to speak to the office.';
 return twiml('<Gather input="dtmf" numDigits="1" timeout="6" actionOnEmptyResult="true" method="POST" action="'+xmlEscape(callbackUrl(base,'choice',sid,attempt))+'">'+say(attempt?'Please press 1, 2 or 0.':words)+'</Gather>');
}
export function route(base,sid,details,ack='') {
 if(!details?.identity) return fallback(base,sid,details?.fallback);
 const params={takeoff_sid:sid,reg:details.reg||'',customer:details.name||'',choice:details.choice||''};
 return twiml((ack?say(ack):'')+'<Dial answerOnBridge="true" timeout="25" action="'+xmlEscape(callbackUrl(base,'dial-result',sid))+'" method="POST"><Client statusCallback="'+xmlEscape(callbackUrl(base,'client-status',sid))+'" statusCallbackMethod="POST" statusCallbackEvent="answered completed"><Identity>'+xmlEscape(details.identity)+'</Identity>'+Object.entries(params).map(([k,v])=>'<Parameter name="'+xmlEscape(k)+'" value="'+xmlEscape(v)+'"/>').join('')+'</Client></Dial>');
}
export function fallback(base,sid,number) {
 // This number is operator-provisioned and SQL rejects the forwarded/company number.
 return number ? twiml(say('Please hold while we connect you to the office.')+'<Dial timeout="20" action="'+xmlEscape(callbackUrl(base,'fallback-result',sid))+'" method="POST"><Number statusCallback="'+xmlEscape(callbackUrl(base,'client-status',sid))+'" statusCallbackMethod="POST" statusCallbackEvent="answered completed">'+xmlEscape(number)+'</Number></Dial>') : unavailable();
}
const encodeBase64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const equal=(a,b)=>{if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0};
export async function signature(url,form,secret) {
 const text=url+[...form.keys()].sort().map(key=>key+form.get(key)).join('');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-1'},false,['sign']);
 return encodeBase64(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(text)));
}
export async function verifySignature(url,form,secret,provided) {
 if(!secret || !provided || new Set(form.keys()).size!==[...form.keys()].length) return false;
 return equal(await signature(url,form,secret),provided);
}
const b64url=text=>encodeBase64(new TextEncoder().encode(text)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
export async function accessToken(account,keySid,keySecret,pushSid,identity,now=Math.floor(Date.now()/1000)) {
 const header=b64url(JSON.stringify({typ:'JWT',alg:'HS256',cty:'twilio-fpa;v=1'}));
 const payload=b64url(JSON.stringify({jti:keySid+'-'+crypto.randomUUID(),iss:keySid,sub:account,iat:now,exp:now+600,grants:{identity,voice:{incoming:{allow:true},push_credential_sid:pushSid}}}));
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(keySecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signed=encodeBase64(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(header+'.'+payload))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
 return header+'.'+payload+'.'+signed;
}
