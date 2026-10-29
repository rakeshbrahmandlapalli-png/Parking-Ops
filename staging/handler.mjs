import './deny-egress.mjs';
import fs from 'node:fs';
const config=JSON.parse(fs.readFileSync(new URL('./synthetic.json',import.meta.url)));
let backend;
export default async function handler(req,res){
 const send=(status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...headers});res.end(status===204?'':JSON.stringify(data));};
 if(process.env.VERCEL_ENV!=='preview'||process.env.VERCEL_PROJECT_ID!==config.projectId||Date.now()>config.expires)return send(403,{message:'Synthetic Preview unavailable or expired'});
 if(req.headers.host!==new URL(config.origin).host||(req.headers.origin&&req.headers.origin!==config.origin))return send(403,{message:'Cross-origin request rejected'});
 if(!['GET','POST','OPTIONS'].includes(req.method))return send(405,{message:'Unsupported synthetic method'});
 if(req.method==='OPTIONS')return send(204,null);
 try{
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>65536)return send(413,{message:'Synthetic request too large'});}
  const body=raw?JSON.parse(raw):{};
  const path=req.url.replace(/^\/_staging/,'');
  if(!path.startsWith('/')||path.includes('..')||path.includes('://'))return send(400,{message:'Invalid synthetic path'});
  backend??=import('./backend.mjs').then(({createBackend})=>createBackend(config));
  const result=await (await backend).handle(path,req.method,req.headers,body);
  send(result.status,result.data,result.headers);
 }catch(error){send(400,{message:String(error.message).slice(0,300)});}
}
