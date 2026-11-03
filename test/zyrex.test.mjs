import test from 'node:test';
import assert from 'node:assert/strict';
import { ZyrexClient } from '../src/provider/zyrex.mjs';
const make = fetchImpl => new ZyrexClient({baseUrl:'https://provider.example/api/v1',apiKey:'private-key',fetchImpl,timeoutMs:50});
test('read-only client sends documented path and server-side key', async () => {
  let request;
  const client = make(async (url, options) => { request = {url,options}; return new Response(JSON.stringify({success:true, data:[]}), {status:200}); });
  assert.deepEqual(await client.read('services', {server:'2'}), {success:true,data:[]});
  assert.equal(request.url.toString(), 'https://provider.example/api/v1/services?server=2');
  assert.equal(request.options.headers['X-API-Key'], 'private-key');
  assert.equal(request.options.redirect, 'error');
  await assert.rejects(client.read('order'), /INVALID_REQUEST/);
  await assert.rejects(client.read('constructor'), /INVALID_REQUEST/);
  await assert.rejects(client.read('services', {unexpected:'x'}), /INVALID_REQUEST/);
});
test('rejects provider business errors, rate limits and invalid JSON', async () => {
  await assert.rejects(make(async () => new Response('{"success":false}', {status:200})).read('balance'), /PROVIDER_REJECTED/);
  await assert.rejects(make(async () => new Response('{}', {status:429})).read('balance'), /RATE_LIMITED/);
  await assert.rejects(make(async () => new Response('bad', {status:200})).read('balance'), /INVALID_RESPONSE/);
});
test('timeout and invalid base URL fail closed', async () => {
  assert.throws(() => new ZyrexClient({baseUrl:'http://provider.example/api/v1',apiKey:'key'}));
  const client = make((_url, {signal}) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))));
  await assert.rejects(client.read('balance'), /TIMEOUT/);
});

test('status reads use documented paths and preserve unresolved 202 without retry', async () => {
  const seen=[];const client=make(async(url,options)=>{seen.push({url:String(url),method:options.method});return new Response(JSON.stringify({pending:true,retryable:false}),{status:202});});
  assert.deepEqual(await client.requestStatus('reservation-1'),{pending:true,retryable:false});
  assert.deepEqual(seen,[{url:'https://provider.example/api/v1/requests/reservation-1',method:'GET'}]);
  await assert.rejects(client.requestStatus('../order'),/INVALID_REQUEST/);
  await assert.rejects(client.orderStatus('123'),/INVALID_RESPONSE/);
});
test('order status is read-only and errors never include returned OTP', async () => {
  let path;const client=make(async url=>{path=String(url);return new Response(JSON.stringify({success:false,otp:'SECRET'}),{status:200});});
  await assert.rejects(client.orderStatus('123'),error=>error.code==='PROVIDER_REJECTED'&&!error.message.includes('SECRET'));
  assert.equal(path,'https://provider.example/api/v1/order/123');
});
