export function sourceRefs(contexts=[]) {
  const seen=new Set();return contexts.filter(x=>x?.url&&!seen.has(x.url)&&seen.add(x.url)).map((x,i)=>({id:i+1,url:x.url,title:x.title}));
}
export function sourceNumber(contexts,context) { return sourceRefs(contexts).find(x=>x.url===context.url)?.id; }
export function sanitizeCitationMarkers(answer,contexts) {
  const ids=new Set(sourceRefs(contexts).map(x=>x.id));
  return String(answer||'').replace(/\[(\d+)\]/g,(marker,id)=>ids.has(Number(id))?marker:'');
}
