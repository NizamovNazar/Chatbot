import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const version=fs.readFileSync(path.join(root,'.node-version'),'utf8').trim();
const [major,minor,patch]=process.versions.node.split('.').map(Number);
const supported=major===24&&(minor>22||minor===22&&patch>=3);
const portable=path.join(root,'.tools',`node-v${version}-win-x64`,'node.exe');
const runtime=supported?process.execPath:process.platform==='win32'&&fs.existsSync(portable)?portable:null;
if(!runtime){console.error(`Node.js ${version} LTS or a newer supported 24.x release is required. Install it and retry; .env and data were not changed.`);process.exit(1);}
const args=process.argv.slice(2),testMode=args.includes('--test');
const env={...process.env,PATH:path.dirname(runtime)+path.delimiter+process.env.PATH};
if(testMode)Object.assign(env,{NODE_ENV:'test',DOTENV_CONFIG_PATH:path.join(root,'.launcher','v22-test-no-env'),DATABASE_URL:'',ADMIN_EMAIL:'',ADMIN_PASSWORD:'',ADMIN_PASSWORD_HASH:'',GEMINI_API_KEY:'',OPENROUTER_API_KEY:'',CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:''});
const child=spawn(runtime,args,{stdio:'inherit',windowsHide:true,env});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
child.on('error',()=>{console.error('Unable to start the supported Node runtime.');process.exitCode=1;});
child.on('exit',(code)=>{process.exitCode=code??1;});
