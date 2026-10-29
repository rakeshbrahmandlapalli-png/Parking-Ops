import fs from 'node:fs';import path from 'node:path';
export const forbidden=['oioqjfrlwrjovnouhusp','oyakdccjpyonfnomhgow','ljrzcrphuepqtfrayeid','https://aero-attendance.vercel.app','cloudflarestorage.com'];
export function auditText(text,label='artifact'){
 for(const value of forbidden)if(text.includes(value))throw Error('Forbidden staging artifact: '+label);
 if(/sb_(?:publishable|secret)_[A-Za-z0-9_-]{8,}/.test(text)||/https?:\/\/[a-z0-9-]+\.supabase\.co/i.test(text))throw Error('Backend credential/URL in staging artifact: '+label);
}
export function auditTree(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())auditTree(file);else auditText(fs.readFileSync(file,'utf8'),file);}}
