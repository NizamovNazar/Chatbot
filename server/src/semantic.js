/**
 * Local latent-semantic retrieval (randomized truncated SVD / LSA).
 * No cloud, API tokens, model downloads or npm dependencies. The index learns
 * word co-occurrences in the university corpus; it is not a transformer model.
 * A deterministic, versioned, corpus-specific index can be rebuilt offline.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { queryTerms } from './quality.js';

export const SEMANTIC_SCHEMA = 1;
const DIMENSIONS = 40;
const MIN_DF = 2;
const MAX_VOCAB = 5500;
const round = n => Math.round(n * 1000000) / 1000000;

function random(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}
function norm(vector) {
  let n = 0;
  for (const v of vector) n += v * v;
  return Math.sqrt(n);
}
function normalized(vector) {
  const len = norm(vector);
  if (len < 1e-9) return [...vector];
  return [...vector].map(v => v / len);
}
export function corpusSignature(docs) {
  const hash = createHash('sha256');
  for (const d of docs) hash.update(String(d.id)+'|'+String(d.fingerprint || '')+'|'+String(d.url)+'|'+String(d.chunk?.length)+'\n');
  return hash.digest('hex');
}
function tokenRows(docs) {
  const rows = docs.map(d => {
    const title = queryTerms(d.title || '').filter(t => t.length > 2);
    // Repeating the short title helps the low-rank model learn page semantics.
    return [...title, ...title, ...queryTerms(d.chunk || '')].filter(t => t.length > 2 && !/^\d+$/.test(t)).slice(0, 750);
  });
  const frequencies = new Map();
  for (const row of rows) for (const term of new Set(row)) frequencies.set(term, (frequencies.get(term) || 0) + 1);
  const selected = [...frequencies].filter(([term,count]) => count >= MIN_DF && count < docs.length * .65)
    .sort((a,b)=>b[1]-a[1]).slice(0,MAX_VOCAB);
  const vocabulary = new Map(selected.map(([term,df],id) => [term,{id,idf:Math.log(1+(docs.length-df+.5)/(df+.5))}]));
  const vectors = rows.map(row=>{
    const tf = new Map();
    for (const term of row) {
      const v = vocabulary.get(term);
      if (v) tf.set(v.id,(tf.get(v.id)||0)+1);
    }
    const sparse=[...tf].map(([id,count])=>[id,(1+Math.log(count))*vocabulary.get(selected[id][0]).idf]);
    const length=Math.sqrt(sparse.reduce((s,x)=>s+x[1]*x[1],0))||1;
    for(const x of sparse)x[1]/=length;
    return sparse;
  });
  return {vocabulary, vectors};
}
function orthonormalize(Y) {
  const n=Y.length,k=Y[0]?.length||0;
  // Modified Gram-Schmidt with a second reorthogonalization pass.
  for(let j=0;j<k;j++) {
    for(let pass=0;pass<2;pass++)for(let p=0;p<j;p++){
      let dot=0;
      for(let i=0;i<n;i++)dot+=Y[i][j]*Y[i][p];
      for(let i=0;i<n;i++)Y[i][j]-=dot*Y[i][p];
    }
    let magnitude=0;
    for(let i=0;i<n;i++)magnitude+=Y[i][j]*Y[i][j];
    magnitude=Math.sqrt(magnitude)||1;
    for(let i=0;i<n;i++)Y[i][j]/=magnitude;
  }
  return Y;
}
function multiplyA(vectors, termCols, dim) {
  return vectors.map(row=>{
    const out=Array(dim).fill(0);
    for(const [id,weight] of row){
      const values=termCols[id];
      if(!values)continue;
      for(let j=0;j<dim;j++)out[j]+=weight*values[j];
    }
    return out;
  });
}
function multiplyAt(vectors, U, vocabSize, dim){
  const out=Array.from({length:vocabSize},()=>Array(dim).fill(0));
  for(let i=0;i<vectors.length;i++)for(const [id,weight] of vectors[i]){
    const dest=out[id], row=U[i];
    for(let j=0;j<dim;j++)dest[j]+=weight*row[j];
  }
  return out;
}
export function buildSemanticIndex(docs, {dimensions=DIMENSIONS,iterations=3}={}) {
  if(!Array.isArray(docs)||docs.length<3)throw new Error('Not enough documents to build semantic index');
  const {vocabulary,vectors}=tokenRows(docs);
  const k=Math.min(dimensions,Math.max(2,docs.length-1),Math.max(2,vocabulary.size-1));
  if(vocabulary.size<3)throw new Error('Not enough vocabulary');
  const rng=random(0x428ab943);
  const randomOmega=Array.from({length:vocabulary.size},()=>Array.from({length:k},()=>rng()*2-1));
  let U=orthonormalize(multiplyA(vectors,randomOmega,k));
  // Randomized subspace iteration approximates principal semantic directions.
  for(let repeat=0;repeat<iterations;repeat++) {
    const projection=multiplyAt(vectors,U,vocabulary.size,k);
    U=orthonormalize(multiplyA(vectors,projection,k));
  }
  const B=multiplyAt(vectors,U,vocabulary.size,k);
  return {
    schema:SEMANTIC_SCHEMA,method:'local-randomized-LSA',corpus:corpusSignature(docs),dimensions:k,
    docs:docs.map((d,i)=>({id:d.id,url:d.url,vector:normalized(U[i]).map(round)})),
    vocabulary:[...vocabulary].map(([term,meta])=>({term,idf:round(meta.idf),vector:B[meta.id].map(round)})),
    builtAt:new Date().toISOString(),
  };
}
export function createSemanticSearch(index,docs) {
  if(!index || index.schema!==SEMANTIC_SCHEMA || index.corpus!==corpusSignature(docs))return null;
  const vocabulary=new Map(index.vocabulary.map(x=>[x.term,x]));
  const byId=new Map(index.docs.map(x=>[x.id,x]));
  const dim=index.dimensions;
  function search(question,limit=100){
    const counts=new Map();
    for(const term of queryTerms(question))if(vocabulary.has(term))counts.set(term,(counts.get(term)||0)+1);
    if(!counts.size)return [];
    const projection=Array(dim).fill(0);
    for(const [term,count] of counts){
      const info=vocabulary.get(term),wt=(1+Math.log(count))*info.idf;
      for(let j=0;j<dim;j++)projection[j]+=wt*info.vector[j];
    }
    const query=normalized(projection);
    if(norm(query)<.00001)return [];
    const scores=[];
    for(const [id,item] of byId){
      let score=0;
      for(let j=0;j<dim;j++)score+=query[j]*item.vector[j];
      if(score>.01)scores.push({id,score});
    }
    scores.sort((a,b)=>b.score-a.score);
    return scores.slice(0,limit);
  }
  return {search,count:byId.size,method:index.method};
}
export function loadSemanticIndex(file,docs){
  try {
    if(!fs.existsSync(file))return {search:null,reason:'not_built'};
    const index=JSON.parse(fs.readFileSync(file,'utf8'));
    const search=createSemanticSearch(index,docs);
    return search?{search,reason:'ok'}:{search:null,reason:'outdated_index'};
  }catch(error){return {search:null,reason:'unreadable_index',error:error.message};}
}
export function writeSemanticIndex(file,index){
  const temp=file+'.tmp';
  fs.writeFileSync(temp,JSON.stringify(index));
  fs.renameSync(temp,file);
}
