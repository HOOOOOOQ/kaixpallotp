import test from 'node:test';
import assert from 'node:assert/strict';
import {applyLedgerOperation} from '../src/wallet/ledger.mjs';
const input = {walletId:'1', operationKey:'reservation-1', entryType:'RESERVE', availableDelta:-30n, reservedDelta:30n, referenceType:'ORDER', referenceId:'order-1', description:'Reserve order', currency:'IDR'};
function fake({existing=[], failInsert=false, balance='100'}={}) {
  const calls=[];
  const conn={calls, async beginTransaction(){calls.push('begin');}, async commit(){calls.push('commit');}, async rollback(){calls.push('rollback');}, release(){calls.push('release');}, async execute(sql,params){
    calls.push({sql,params});
    if(sql.startsWith('SELECT id, currency')) return [[{currency:'IDR',available_minor:balance,reserved_minor:'0'}]];
    if(sql.startsWith('SELECT entry_type')) return [existing];
    if(sql.startsWith('INSERT INTO wallet_ledger') && failInsert) throw new Error('insert failure');
    return [{}];
  }};
  return {conn,pool:{async getConnection(){return conn;}}};
}
test('ledger uses locked wallet and commits balance and entry together',async()=>{
  const {pool,conn}=fake(); assert.deepEqual(await applyLedgerOperation(pool,input),{replayed:false,available:'70',reserved:'30'});
  assert.match(conn.calls[1].sql,/FOR UPDATE/); assert.ok(conn.calls.some(c=>c.sql?.startsWith('INSERT INTO wallet_ledger'))); assert.deepEqual(conn.calls.slice(-2),['commit','release']);
});
test('ledger replay requires identical operation and never moves balance twice',async()=>{
  const existing=[{entry_type:'RESERVE',available_delta_minor:'-30',reserved_delta_minor:'30',reference_type:'ORDER',reference_id:'order-1',description:'Reserve order',created_by:null,new_available_minor:'70',new_reserved_minor:'30'}];
  const {pool,conn}=fake({existing}); assert.equal((await applyLedgerOperation(pool,input)).replayed,true); assert.equal(conn.calls.some(c=>c.sql?.startsWith('UPDATE wallets')),false);
  await assert.rejects(applyLedgerOperation(pool,{...input,availableDelta:-20n}),/Idempotency conflict/);
});
test('insufficient funds and failed insertion roll back',async()=>{
  const a=fake({balance:'1'}); await assert.rejects(applyLedgerOperation(a.pool,input),/Insufficient balance/); assert.ok(a.conn.calls.includes('rollback'));
  const b=fake({failInsert:true}); await assert.rejects(applyLedgerOperation(b.pool,input),/insert failure/); assert.ok(b.conn.calls.includes('rollback'));
  await assert.rejects(applyLedgerOperation(b.pool,{...input,availableDelta:1}),/Invalid ledger operation/);
});
