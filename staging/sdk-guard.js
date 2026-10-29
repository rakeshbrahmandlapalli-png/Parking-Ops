(function(){
 'use strict';
 if(!window.STAGING_CONFIG||!window.supabase)throw Error('Staging cannot start without its configuration and SDK');
 var create=window.supabase.createClient;
 window.supabase.createClient=function(url,key,opts){
  if(url!==window.STAGING_CONFIG.apiBase||key!==window.STAGING_CONFIG.publicKey)throw Error('Staging rejected backend or credentials');
  opts=Object.assign({},opts,{auth:Object.assign({},opts&&opts.auth,{storageKey:'staging-'+(opts&&opts.auth&&opts.auth.storageKey||'parking-auth')})});
  var client=create(url,key,opts);var signOut=client.auth.signOut.bind(client.auth);client.auth.signOut=function(options){return signOut(Object.assign({},options,{scope:'local'}));};return client;
 };
})();
