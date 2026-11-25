import axios from 'axios';import dns from 'node:dns/promises';import net from 'node:net';import http from 'node:http';import https from 'node:https';
import {isOfficialSource} from './knowledgeMetadata.js';
const ipv4=new net.BlockList(),ipv6=new net.BlockList();
for(const [ip,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['100.64.0.0',10],['192.0.0.0',24],['198.18.0.0',15],['224.0.0.0',4],['240.0.0.0',4]])ipv4.addSubnet(ip,prefix,'ipv4');
for(const [ip,prefix] of [['::',128],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8],['::ffff:0:0',96]])ipv6.addSubnet(ip,prefix,'ipv6');
export function publicAddress(address){const family=net.isIP(address);return family===4?!ipv4.check(address,'ipv4'):family===6?!ipv6.check(address,'ipv6'):false;}
export function allowedFetchUrl(raw){try{const u=new URL(raw);return isOfficialSource(u.href)&&['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&(!u.port||u.port==='80'&&u.protocol==='http:'||u.port==='443'&&u.protocol==='https:');}catch{return false;}}
export async function safeGetOfficial(raw,{client=axios,lookup=host=>dns.lookup(host,{all:true}),timeout=16000}={}) {
 let url=new URL(raw);
 for(let redirects=0;redirects<=4;redirects++){
  if(!allowedFetchUrl(url.href))throw new Error('CRAWL_URL_NOT_ALLOWED');
  let timer;let addresses;
  try{addresses=await Promise.race([lookup(url.hostname),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('CRAWL_DNS_TIMEOUT')),5000);})]);}finally{clearTimeout(timer);}
  if(!Array.isArray(addresses)||!addresses.length||addresses.some(x=>!publicAddress(x.address)))throw new Error('CRAWL_PRIVATE_ADDRESS');
  const pinned=addresses[0];const pinLookup=(host,options,callback)=>{if(typeof options==='function'){callback=options;options={};}callback(null,options?.all?[pinned]:pinned.address,pinned.family);};
  const httpAgent=new http.Agent({lookup:pinLookup}),httpsAgent=new https.Agent({lookup:pinLookup});
  try{
   const response=await client.get(url.href,{timeout,responseType:'arraybuffer',maxContentLength:2500000,maxBodyLength:2500000,maxRedirects:0,proxy:false,httpAgent,httpsAgent,validateStatus:status=>status>=200&&status<400,headers:{'User-Agent':'OA-Smart-Assistant-EducationalBot/0.5'}});
   if([301,302,303,307,308].includes(response.status)){if(!response.headers.location)throw new Error('CRAWL_INVALID_REDIRECT');const next=new URL(response.headers.location,url);if(url.protocol==='https:'&&next.protocol!=='https:')throw new Error('CRAWL_HTTPS_DOWNGRADE');url=next;continue;}
   return {...response,finalUrl:url.href};
  }finally{httpAgent.destroy();httpsAgent.destroy();}
 }throw new Error('CRAWL_TOO_MANY_REDIRECTS');
}
