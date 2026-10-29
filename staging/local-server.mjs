// Local acceptance server only. Not part of the deployed static tree/function.
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';
const out=new URL('./.vercel/output/',import.meta.url),config=JSON.parse(fs.readFileSync(new URL('config.json',out))),state=JSON.parse(fs.readFileSync(new URL('functions/synthetic.func/synthetic.json',out)));
process.env.VERCEL_ENV='preview';process.env.VERCEL_PROJECT_ID=state.projectId;
let handlerPromise;
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
http.createServer(async(req,res)=>{
 for(const [key,value] of Object.entries(config.routes[0].headers))res.setHeader(key,value);
 if(req.url.startsWith('/_staging/'))return (await handlerPromise)(req,res);
 let p=new URL(req.url,state.origin).pathname;
 p=({'/':'/index.html','/attendance/':'/attendance/index.html','/attendance/manager':'/attendance/admin.html','/manifest.webmanifest':'/manifest-default.webmanifest'})[p]||p;
 const file=path.resolve(new URL('static/',out).pathname,'.'+decodeURIComponent(p));
 if(!file.startsWith(new URL('static/',out).pathname)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end('Not found');return;}
 res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.writeHead(200);res.end(fs.readFileSync(file));
}).listen(Number(new URL(state.origin).port),'127.0.0.1',()=>{handlerPromise=import(new URL('functions/synthetic.func/handler.mjs',out)).then(m=>m.default);handlerPromise.then(()=>console.log('SYNTHETIC_READY'));});
