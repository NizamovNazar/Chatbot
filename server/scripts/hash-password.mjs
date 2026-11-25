import {emitKeypressEvents} from 'node:readline';
import {hashPassword} from '../src/adminAuth.js';
if(!process.stdin.isTTY)throw new Error('Use an interactive terminal. Do not pass the password in command arguments or shell history.');
emitKeypressEvents(process.stdin);
async function secret(prompt){process.stdout.write(prompt);process.stdin.setRawMode(true);process.stdin.resume();return new Promise((resolve,reject)=>{let value='';const handler=(text,key)=>{if(key?.ctrl&&key.name==='c'){cleanup();reject(new Error('Cancelled'));}else if(key?.name==='return'){cleanup();resolve(value);}else if(key?.name==='backspace')value=value.slice(0,-1);else if(!key?.ctrl&&!key?.meta&&text)value+=text;};function cleanup(){process.stdin.off('keypress',handler);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');}process.stdin.on('keypress',handler);});}
const first=await secret('New strong administrator password (input hidden): ');const second=await secret('Repeat password: ');if(first!==second)throw new Error('Passwords do not match. No files were changed.');
console.log('ADMIN_PASSWORD_HASH='+await hashPassword(first));
console.log('Store this hash privately as a hosting secret. No configuration file was changed.');
