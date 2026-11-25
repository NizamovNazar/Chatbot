export const REPORT_TIME_ZONE='Europe/Kyiv';
const format=new Intl.DateTimeFormat('en-CA',{timeZone:REPORT_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export function kyivParts(date=new Date()){const d=new Date(date);if(!Number.isFinite(d.getTime()))return null;return Object.fromEntries(format.formatToParts(d).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));}
const pad=n=>String(n).padStart(2,'0');
export function kyivDay(date=new Date()){const p=kyivParts(date);return p?`${p.year}-${pad(p.month)}-${pad(p.day)}`:null;}
export function validDay(key){if(typeof key!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(key))return false;const [y,m,d]=key.split('-').map(Number);const date=new Date(Date.UTC(y,m-1,d));return y>=1970&&date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d;}
export function utcMidnight(key){if(!validDay(key))throw new Error('invalid_calendar_date');const [y,m,d]=key.split('-').map(Number);const target=Date.UTC(y,m-1,d);let guess=target;for(let i=0;i<3;i++){const p=kyivParts(guess);const offset=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-guess;guess=target-offset;}return guess;}
export function dayBounds(key){const start=utcMidnight(key);const next=new Date(key+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+1);return {start,end:utcMidnight(next.toISOString().slice(0,10))};}
