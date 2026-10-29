/* Generated Preview configuration loads before every application script. */
(function(){
 'use strict';
 var info=window.__STAGING_BUILD__;
 if(!info||info.mode!=='synthetic-preview'||info.origin!==location.origin)throw Error('Staging configuration missing or invalid');
 var api=location.origin+'/_staging';
 function allowed(value){var u=new URL(typeof value==='string'?value:value.url,location.href);return u.origin===location.origin&&u.username===''&&u.password==='';}
 var originalFetch=window.fetch.bind(window);
 window.fetch=function(value,options){if(!allowed(value))return Promise.reject(new TypeError('Staging blocks external destinations'));return originalFetch(value,options);};
 var originalOpen=XMLHttpRequest.prototype.open;
 XMLHttpRequest.prototype.open=function(method,url){if(!allowed(url))throw Error('Staging blocks external destinations');return originalOpen.apply(this,arguments);};
 window.WebSocket=class {
  constructor(url){var u=new URL(url);if(u.host!==location.host||!u.pathname.startsWith('/_staging/realtime/'))throw Error('Staging blocks external sockets');this.readyState=0;setTimeout(()=>{this.readyState=1;if(this.onopen)this.onopen({});},0);}
  send(raw){var m=JSON.parse(raw),a=Array.isArray(m),ref=a?m[1]:m.ref,topic=a?m[2]:m.topic,event=a?m[3]:m.event;
   if(event==='phx_join'||event==='heartbeat'){var payload={status:'ok',response:{postgres_changes:[]}};setTimeout(()=>{if(this.onmessage)this.onmessage({data:JSON.stringify(a?[m[0],ref,topic,'phx_reply',payload]:{ref,topic,event:'phx_reply',payload})});},0);}}
  close(){this.readyState=3;if(this.onclose)this.onclose({code:1000});}
  addEventListener(name,fn){this['on'+name]=fn;} removeEventListener(name){this['on'+name]=null;}
 };
 window.EventSource=function(){throw Error('External streaming is disabled in synthetic staging');};
 navigator.sendBeacon=function(){return false;};
 if(window.PushManager){PushManager.prototype.subscribe=function(){return Promise.reject(Error('Synthetic staging uses local notifications; remote push is disabled'));};PushManager.prototype.getSubscription=function(){return Promise.resolve(null);};}
 var open=window.open;window.open=function(url){if(!allowed(url))throw Error('Staging blocks external navigation');return open.apply(window,arguments);};
 document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href]');if(a&&!allowed(a.href)){e.preventDefault();e.stopImmediatePropagation();}},true);
 var config=Object.freeze({mode:info.mode,apiBase:api,publicKey:'staging-public-v1',client:function(){return {url:api,key:'staging-public-v1',shared:true};}});
 Object.defineProperty(window,'STAGING_CONFIG',{value:config,writable:false,configurable:false});
 window.addEventListener('DOMContentLoaded',function(){
  var banner=document.createElement('div');banner.style.cssText='position:sticky;top:0;z-index:10000;background:#fff3cd;color:#302600;padding:8px;font:14px system-ui;text-align:center';
  var link=document.createElement('a');link.href='/staging.html';link.textContent='Synthetic Preview · disposable data · test controls';banner.appendChild(link);document.body.prepend(banner);
 });
})();
