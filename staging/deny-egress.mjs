// The synthetic function has no supported outbound network capability.
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import dgram from 'node:dgram';
import child from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
export const deny=()=>{throw Error('Synthetic backend denies outbound I/O');};
globalThis.fetch=deny;globalThis.WebSocket=class{constructor(){deny();}};
net.connect=net.createConnection=tls.connect=http.request=http.get=https.request=https.get=deny;
net.Socket.prototype.connect=deny;
for(const k of ['lookup','resolve','resolve4','resolve6'])dns[k]=deny;
dns.promises.lookup=dns.promises.resolve=deny;dgram.createSocket=deny;
for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])child[k]=deny;
syncBuiltinESMExports();
