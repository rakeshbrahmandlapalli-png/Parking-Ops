// Explicit, Preview-only Build Output API. Never changes production public/.
import fs from 'node:fs';
import {auditTree} from './audit.mjs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.dirname(here);
const local=process.env.STAGING_LOCAL==='1';
if(process.env.STAGING_MODE!=='1'||process.env.VERCEL_ENV!=='preview')throw Error('Staging requires explicit Preview mode');
const projectId=process.env.STAGING_PROJECT_ID;
if(!projectId||projectId==='prj_Ll3pMLhK1tF1ur4CcpV8H1vSQQ7m'||projectId===process.env.STAGING_FORBIDDEN_PROJECT||(!local&&projectId!==process.env.VERCEL_PROJECT_ID))throw Error('Staging project mismatch');
const origin=local?'http://localhost:'+process.env.STAGING_PORT:'https://'+process.env.VERCEL_URL;
if(!local&&(!process.env.VERCEL_URL||!new URL(origin).hostname.endsWith('.vercel.app')))throw Error('Missing Preview origin');
const out=path.join(here,'.vercel/output'),stat=path.join(out,'static'),func=path.join(out,'functions/synthetic.func');
fs.rmSync(out,{recursive:true,force:true});for(const dir of [stat,func])fs.mkdirSync(dir,{recursive:true});
const pin=JSON.parse(fs.readFileSync(path.join(here,'aero-source.json')));
if(!/^[a-f0-9]{40}$/.test(pin.sha))throw Error('Pin an exact Aero commit');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'synthetic-build-'));
const aero=local?process.env.STAGING_AERO_ROOT:path.join(work,'aero');
const files=['index.html','admin.html','shared-backend.js','sw.js','manifest.webmanifest','manager.webmanifest','staging/artifacts.mjs','checks/harness.mjs','checks/shared-fixture.mjs','checks/shared-manager-fixture.mjs','checks/shared-test-api.mjs','setup/schema.sql'];
if(!local){
 const tree=await fetch('https://api.github.com/repos/rakeshbrahmandlapalli-png/aero-attendance/git/trees/'+pin.sha+'?recursive=1',{redirect:'error'});if(!tree.ok)throw Error('Cannot verify pinned Aero tree');
 const listing=await tree.json();files.push(...listing.tree.filter(f=>f.type==='blob'&&f.path.startsWith('icons/')).map(f=>f.path));
 for(const file of files){const response=await fetch('https://raw.githubusercontent.com/rakeshbrahmandlapalli-png/aero-attendance/'+pin.sha+'/'+file,{redirect:'error'});if(!response.ok)throw Error('Missing pinned Aero file '+file);const target=path.join(aero,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,Buffer.from(await response.arrayBuffer()));}
}
if(!aero)throw Error('Local Aero source required');
const {attendanceArtifact}=await import(pathToFileURL(path.join(aero,'staging/artifacts.mjs')));
const refs=['oioqjfrlwrjovnouhusp','oyakdccjpyonfnomhgow','ljrzcrphuepqtfrayeid'];
function scrub(text){
 for(const ref of refs)text=text.replaceAll(ref,'synthetic-only');
 return text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'staging-public-v1')
  .replace(/sb_(?:publishable|secret)_[A-Za-z0-9_-]+/g,'staging-public-v1')
  .replace(/https?:\/\/[^\s"'<>`\\)]+/g,'/_staging/blocked')
  .replace(/[A-Za-z0-9.-]+\.(?:supabase\.co|cloudflarestorage\.com|maptiler\.com|openstreetmap\.org|vercel\.app)/g,'synthetic.invalid')
  .replace(/var VAPID_PUBLIC_KEY\s*=\s*['"][^'"]+['"]/g,'var VAPID_PUBLIC_KEY="staging-local-only"');
}
function write(relative,contents){const target=path.join(stat,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,contents);}
function copyTree(from,prefix='',transform=scrub){
 for(const entry of fs.readdirSync(from,{withFileTypes:true})){
  const rel=prefix+entry.name,p=path.join(from,entry.name);
  if(entry.isDirectory()){if(['icons','vendor','fonts'].includes(entry.name))copyTree(p,rel+'/',transform);continue;}
  if(!/\.(?:html|js|css|json|webmanifest|svg|png|jpg|woff2?)$/.test(entry.name))continue;
  write(rel,/\.(?:html|js|css|json|webmanifest|svg)$/.test(entry.name)?transform(fs.readFileSync(p,'utf8')):fs.readFileSync(p));
 }
}
copyTree(path.join(root,'public'));
for(const name of ['index.html','admin.html','shared-backend.js'])write('attendance/'+name,scrub(attendanceArtifact(fs.readFileSync(path.join(aero,name),'utf8'))));
copyTree(path.join(aero,'icons'),'attendance/icons/');
for(const name of ['manifest.webmanifest','manager.webmanifest']){
 const m=JSON.parse(fs.readFileSync(path.join(aero,name),'utf8'));m.id=name.startsWith('manager')?'/attendance/manager':'/attendance/';m.start_url=m.id+'?pilot=1';m.scope='/attendance/';m.name='Synthetic '+m.name;m.icons=m.icons.map(i=>({...i,src:'/attendance/'+i.src.replace(/^\//,'')}));write('attendance/'+name,JSON.stringify(m));
}
// Extract every inline script, allowing script-src self without unsafe-inline.
for(const name of ['index.html','attendance/index.html','attendance/admin.html']){
 let html=fs.readFileSync(path.join(stat,name),'utf8'),i=0;
 if(name==='index.html')html=html.replace('<head>','<head><script src="/staging-config.js"></script>').replace('<script src="/app.js">','<script src="/staging-sdk-guard.js"></script><script src="/app.js">');
 html=html.replace(/<script>([\s\S]*?)<\/script>/g,(_,code)=>{const file='staging-inline/'+name.replaceAll('/','-')+'-'+(++i)+'.js';write(file,code);return '<script src="/'+file+'"></script>';});write(name,html);
}
const parkingSha=process.env.VERCEL_GIT_COMMIT_SHA||execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const config={mode:'synthetic-preview',origin,projectId,parkingSha,aeroSha:pin.sha,created:Date.now(),expires:Date.now()+86400000,password:'synthetic-'+crypto.randomBytes(12).toString('hex'),pin:String(crypto.randomInt(1000,10000))};
write('staging-config.js','window.__STAGING_BUILD__='+JSON.stringify({mode:config.mode,origin,parkingSha,aeroSha:pin.sha})+';\n'+fs.readFileSync(path.join(here,'client.js')));
write('staging-sdk-guard.js',fs.readFileSync(path.join(here,'sdk-guard.js')));
write('staging.html',fs.readFileSync(path.join(here,'landing.html')));write('staging-controls.js',fs.readFileSync(path.join(here,'controls.js')));
for(const name of ['sw.js','attendance/sw.js'])write(name,fs.readFileSync(path.join(here,'worker.js')));
for(const name of ['handler.mjs','backend.mjs','deny-egress.mjs'])fs.copyFileSync(path.join(here,name),path.join(func,name));
fs.writeFileSync(path.join(func,'synthetic.json'),JSON.stringify(config));
for(const name of ['harness.mjs','shared-fixture.mjs','shared-manager-fixture.mjs','shared-test-api.mjs']){
 const target=path.join(func,'aero/checks',name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,scrub(fs.readFileSync(path.join(aero,'checks',name),'utf8')).replace("apiOrigin = '/_staging/blocked'","apiOrigin = 'http://synthetic.invalid'"));
}
fs.writeFileSync(path.join(func,'aero/checks/shared-checkout.mjs'),"import fs from 'node:fs';export function verifySharedCheckouts(){};export const readParking=p=>fs.readFileSync(new URL('../../parking/'+p,import.meta.url),'utf8');\n");
fs.mkdirSync(path.join(func,'aero/setup'),{recursive:true});fs.writeFileSync(path.join(func,'aero/setup/schema.sql'),scrub(fs.readFileSync(path.join(aero,'setup/schema.sql'),'utf8')));
for(const name of ['133-attendance-addon.sql','134-attendance-identity.sql','135-attendance-pilot.sql','136-attendance-shared.sql']){
 const target=path.join(func,'parking/setup',name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,scrub(fs.readFileSync(path.join(root,'setup',name),'utf8')));
}
const dependency=JSON.parse(fs.readFileSync(path.join(here,'dependency.json'))),dest=path.join(func,'node_modules/@electric-sql/pglite');fs.mkdirSync(dest,{recursive:true});
if(local)fs.cpSync(path.join(root,'checks/node_modules/@electric-sql/pglite'),dest,{recursive:true});
else{
 const r=await fetch(dependency.url,{redirect:'error'});if(!r.ok)throw Error('Cannot load pinned synthetic SQL runtime');const data=Buffer.from(await r.arrayBuffer());
 if('sha512-'+crypto.createHash('sha512').update(data).digest('base64')!==dependency.integrity)throw Error('Synthetic runtime integrity mismatch');
 const archive=path.join(work,'pglite.tgz');fs.writeFileSync(archive,data);execFileSync('tar',['-xzf',archive,'--strip-components=1','-C',dest]);
}
fs.writeFileSync(path.join(func,'.vc-config.json'),JSON.stringify({runtime:'nodejs24.x',handler:'handler.mjs',launcherType:'Nodejs',shouldAddHelpers:true,maxDuration:60}));
const csp="default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const headers={'Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Permissions-Policy':'geolocation=(self), camera=(), microphone=()','Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'};
fs.writeFileSync(path.join(out,'config.json'),JSON.stringify({version:3,routes:[{src:'/(.*)',headers,continue:true},{src:'/_staging(?:/.*)?',dest:'/synthetic'},{src:'/attendance/manager',dest:'/attendance/admin.html'},{src:'/attendance/',dest:'/attendance/index.html'},{src:'/manifest.webmanifest',dest:'/manifest-default.webmanifest'},{handle:'filesystem'},{src:'/',dest:'/index.html'}]}));
// Inspect every app/backend artifact, including SQL. Never deploy a leaky build.
auditTree(out);
console.log(JSON.stringify({mode:config.mode,parkingSha,aeroSha:pin.sha,origin,out,expires:config.expires}));
fs.rmSync(work,{recursive:true,force:true});
