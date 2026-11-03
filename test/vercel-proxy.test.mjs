import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {proxy} from '../api/proxy.mjs';
function request({method='GET',url='/api/proxy?__p=account%2Foverview&page=2',headers={},body}={}) {const req=Readable.from([]);Object.assign(req,{method,url,headers,body});return req;}
function response(){return {headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(body){this.body=body;}};}
test('proxy uses configured HTTPS backend, preserves API path, origin, query and cookies',async()=>{
 const req=request({headers:{origin:'https://frontend.example',cookie:'pall_session=test'}}),res=response();let seen;
 await proxy(req,res,{backendUrl:'https://backend.example/',fetchImpl:async(url,options)=>{seen={url:String(url),options};return new Response('{"ok":true}',{status:200,headers:{'content-type':'application/json','set-cookie':'session=abc; HttpOnly; Secure'}});}});
 assert.equal(seen.url,'https://backend.example/api/account/overview?page=2');assert.equal(seen.options.headers.origin,'https://frontend.example');assert.equal(seen.options.redirect,'manual');assert.equal(res.statusCode,200);assert.deepEqual(res.headers['set-cookie'],['session=abc; HttpOnly; Secure']);
});
test('proxy refuses unsafe backend, invalid paths, redirects and oversize requests',async()=>{
 let res=response();await proxy(request(),res,{backendUrl:'http://localhost:3000'});assert.equal(res.statusCode,503);
 res=response();await proxy(request({url:'/api/proxy?__p=..%2F..%2Fsecret'}),res,{backendUrl:'https://backend.example/'});assert.equal(res.statusCode,400);
 res=response();await proxy(request(),res,{backendUrl:'https://backend.example/',fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://evil.example'}})});assert.equal(res.statusCode,502);
 res=response();await proxy(request({method:'POST',body:'x'.repeat(16385)}),res,{backendUrl:'https://backend.example/'});assert.equal(res.statusCode,413);
});
