import test from 'node:test';
import assert from 'node:assert/strict';
import { zyrexRead } from '../src/provider/vercel-read.mjs';
const env={ZYREX_BASE_URL:'https://provider.example/api/v1',ZYREX_API_KEY:'PRIVATE-PROVIDER-KEY',ZYREX_ACCESS_TOKEN:'abcdefghijklmnopqrstuvwxyz0123456789'};
const req=(url='/api/proxy?__p=zyrex&operation=services',auth=`Bearer ${env.ZYREX_ACCESS_TOKEN}`,method='GET')=>({url,method,headers:{authorization:auth}});
function response(){return {headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v},end(body){this.body=body}}}
test('read-only operator endpoint sends provider key server-side', async()=>{
 let seen;const res=response();await zyrexRead(req('/api/proxy?__p=zyrex&path=zyrex&operation=services&server=2'),res,{env,fetchImpl:async(url,options)=>{seen={url:String(url),options};return new Response(JSON.stringify({success:true,data:[]}),{status:200})}});
 assert.equal(res.statusCode,200);assert.equal(seen.url,'https://provider.example/api/v1/services?server=2');assert.equal(seen.options.headers['X-API-Key'],env.ZYREX_API_KEY);assert.ok(!res.body.includes(env.ZYREX_API_KEY));assert.equal(res.headers['cache-control'],'no-store');
});
test('rejects unauthorized, writes, sensitive operations, invalid input and missing configuration',async()=>{
 for(const [request,config,status] of [[req(undefined,'Bearer wrong'),env,401],[req(undefined,undefined,'POST'),env,405],[req('/?operation=balance'),env,400],[req('/?operation=order'),env,400],[req('/?operation=services&server=7'),env,400],[req('/?operation=offers&service_id=1'),env,400],[req(),{},503]]){const res=response();await zyrexRead(request,res,{env:config,fetchImpl:()=>{throw Error('must not call')}});assert.equal(res.statusCode,status);}
});
test('provider errors never expose credentials or raw provider response',async()=>{const res=response();await zyrexRead(req(),res,{env,fetchImpl:async()=>new Response('{"success":false,"message":"PRIVATE-PROVIDER-KEY"}',{status:200})});assert.equal(res.statusCode,502);assert.ok(!res.body.includes(env.ZYREX_API_KEY));});
