import {kyivDay} from '../../shared/time.mjs';
export function createAiGuard({storage,maxConcurrent=2,dailyAttempts=40,now=()=>new Date()}) {
 let active=0,lastCount=null;
 const error=code=>Object.assign(new Error(code),{code});
 return {
  status:()=>({active,maxConcurrent,dailyAttempts,attempts:lastCount}),
  async reserve(){const count=await storage.update(state=>{
    if(Object.keys(state).length&&(typeof state.day!=='string'||!Number.isSafeInteger(state.attempts)||state.attempts<0))throw error('AI_BUDGET_STORAGE_INVALID');
    const day=kyivDay(now());if(state.day!==day){state.day=day;state.attempts=0;}
    if(state.attempts>=dailyAttempts)throw error('AI_BUDGET_EXHAUSTED');return ++state.attempts;
   });lastCount=count;},
  async run(work){if(active>=maxConcurrent)throw error('AI_BUSY');active++;try{return await work();}finally{active--;}}
 };
}
