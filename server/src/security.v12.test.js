import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigin, corsGuard, envInteger, fixedWindowLimit, validatedQa, validatedQuickItems } from './security.js';

test('origin policy accepts same host and local vite, rejects external and malformed URLs',()=>{
  assert.equal(allowedOrigin(undefined,'localhost:5000',{production:true}),true);
  assert.equal(allowedOrigin('https://oa-app.onrender.com','oa-app.onrender.com',{production:true}),true);
  assert.equal(allowedOrigin('http://oa-app.onrender.com','oa-app.onrender.com',{production:true}),false);
  assert.equal(allowedOrigin('https://other.test','oa-app.onrender.com',{production:true}),false);
  assert.equal(allowedOrigin('https://other.test','oa-app.onrender.com',{production:true,configuredOrigins:'https://other.test'}),true);
  assert.equal(allowedOrigin('http://localhost:5173','localhost:5000',{production:false}),true);
  assert.equal(allowedOrigin('https://evil.test','localhost:5000',{production:false}),false);
  assert.equal(allowedOrigin('null','localhost:5000',{production:true}),false);
});

test('rate limiter responds with retry header and resets correctly',()=>{
  let now=1000;
  const limit=fixedWindowLimit({maxRequests:2,windowMs:1000,now:()=>now});
  const headers={};let status=200;let nextCalled=0;let error=null;
  const request={ip:'192.0.2.12'};
  const response={set(k,v){headers[k]=v;return this;},status(s){status=s;return this;},json(v){error=v;return this;}};
  limit(request,response,()=>nextCalled++);limit(request,response,()=>nextCalled++);
  assert.equal(nextCalled,2);
  limit(request,response,()=>nextCalled++);assert.equal(status,429);assert.equal(error.code,'rate_limited');assert.equal(headers['Retry-After'],'1');
  now=2000;limit(request,response,()=>nextCalled++);assert.equal(nextCalled,3);
});

test('strict limits and data validators',()=>{
  assert.equal(envInteger('999',7,1,20),7);
  assert.equal(envInteger('3.5',7,1,20),7);
  assert.equal(envInteger('10',7,1,20),10);
  assert.deepEqual(validatedQa({question:' питання  ',answer:' відповідь '}),{question:'питання',answer:'відповідь'});
  assert.equal(validatedQa({question:[],answer:'answer'}),null);
  assert.equal(validatedQa({question:'q',answer:'a'}),null);
  assert.equal(validatedQuickItems([1]),null);
  assert.deepEqual(validatedQuickItems([' First ']),['First']);
});
