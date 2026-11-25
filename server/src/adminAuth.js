import { randomBytes, createHash, createHmac, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { atomicJsonWrite, readJsonStrict } from './storage.js';
const scrypt = promisify(scryptCallback);
const equal = (a,b) => {const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);};
export function strongPassword(value) {
  const p=String(value||'');
  return p.length>=12 && p.length<=256 && new Set(p).size>=6 && [/[a-z]/,/[A-Z]/,/\d/,/[^\p{L}\p{N}]/u].filter(r=>r.test(p)).length>=3;
}
export async function hashPassword(password) {
  if(!strongPassword(password)) throw new Error('Password must contain 12–256 characters and at least three character classes.');
  const salt=randomBytes(16).toString('hex');
  const key=await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
  return `scrypt$v1$${salt}$${key.toString('hex')}`;
}
export function passwordVerifier(env) {
  const email=String(env.ADMIN_EMAIL||'').trim().toLowerCase();
  const hash=String(env.ADMIN_PASSWORD_HASH||'');
  const plain=String(env.ADMIN_PASSWORD||'');
  if(hash && !/^scrypt\$v1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(hash)) throw new Error('ADMIN_CONFIG: invalid ADMIN_PASSWORD_HASH format.');
  if(env.NODE_ENV==='production' && (!email || (!hash&&!strongPassword(plain))))
    throw new Error('ADMIN_CONFIG: production requires ADMIN_EMAIL and a strong password or ADMIN_PASSWORD_HASH. Existing credentials were not changed.');
  return {
    configured:Boolean(email&&(hash||plain)),
    fingerprint:createHash('sha256').update(`${email}:${hash||plain}`).digest('hex'),
    async verify(actualEmail,password) {
      if(typeof actualEmail!=='string'||typeof password!=='string'||password.length>256)return false;
      let valid;
      if(hash){const parts=hash.split('$');const key=await scrypt(password,parts[2],64,{N:16384,r:8,p:1,maxmem:64*1024*1024});valid=timingSafeEqual(key,Buffer.from(parts[3],'hex'));}
      else valid=equal(password,plain);
      return Boolean(email&&(hash||plain))&&equal(actualEmail.trim().toLowerCase(),email)&&valid;
    },
  };
}

export function fileAuthStorage(file) {
  // Read/write on every transaction: a lost/corrupt file must not silently reset the limit.
  let queue=Promise.resolve(), existed=false;
  return { update(change) {
    const job=async()=>{
      let state=readJsonStrict(file,null);
      if(state===null){if(existed)throw new Error('AUTH_STORAGE_UNAVAILABLE');state={};}
      if(typeof state!=='object'||Array.isArray(state))throw new Error('AUTH_STORAGE_CORRUPT');
      const result=await change(state);atomicJsonWrite(file,state);existed=true;return result;
    };
    const next=queue.then(job);queue=next.catch(()=>{});return next;
  }};
}

export function createAdminAuth({env,storage,now=Date.now}) {
  const verifier=passwordVerifier(env),sessions=new Map();
  const bounded=(v,d,min,max)=>/^\d+$/.test(String(v))&&Number(v)>=min&&Number(v)<=max?Number(v):d;
  const ipMax=bounded(env.LOGIN_RATE_MAX,7,1,500),accountMax=bounded(env.LOGIN_ACCOUNT_MAX,12,1,500);
  const windowMs=bounded(env.LOGIN_BLOCK_MS,15*60*1000,100,86400000);
  const sessionMs=bounded(env.ADMIN_SESSION_MS,8*60*60*1000,100,86400000);
  const key=s=>createHmac('sha256',verifier.fingerprint).update(s).digest('hex');
  return {
    configured:verifier.configured,
    verify:verifier.verify,
    async login(email,password,ip) {
      if(typeof email!=='string'||typeof password!=='string'||email.length>320||password.length>256)return {status:401,error:'invalid_credentials'};
      return storage.update(async state=>{
        const time=now();for(const [id,entry] of Object.entries(state))if(!entry||entry.resetAt<=time)delete state[id];
        if(Object.keys(state).length>10000)throw new Error('AUTH_STORAGE_CAPACITY');
        const ids=[key('ip:'+ip),key('account:'+email.trim().toLowerCase())],limits=[ipMax,accountMax];
        const retry=()=>Math.max(...ids.map((id,i)=>state[id]?.failures>=limits[i]?Math.max(0,state[id].resetAt-time):0));
        const blocked=retry();if(blocked>0)return {status:429,error:'temporarily_blocked',retryAfter:Math.ceil(blocked/1000)};
        const valid=await verifier.verify(email,password);
        if(valid){for(const id of ids)delete state[id];return {status:200};}
        ids.forEach(id=>{state[id]||={failures:0,resetAt:time+windowMs};state[id].failures++;});
        const wait=retry();return wait>0?{status:429,error:'temporarily_blocked',retryAfter:Math.ceil(wait/1000)}:{status:401,error:'invalid_credentials'};
      }).then(result=>{
        // A token is issued only AFTER the durable login transaction succeeds.
        if(result.status!==200)return result;
        const token=randomBytes(32).toString('hex');for(const [t,expires] of sessions)if(expires<=now())sessions.delete(t);
        sessions.set(token,now()+sessionMs);return {...result,token,expiresIn:sessionMs/1000};
      });
    },
    valid(token){const expires=sessions.get(token);if(!expires||expires<=now()){sessions.delete(token);return false;}return true;},
    logout(token){sessions.delete(token);},
  };
}
