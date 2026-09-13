import { test } from "node:test";
import assert from "node:assert/strict";
import { queueJournal, flushJournal } from "../../lib/client/journal.ts";

test("a failed upload retains messages, retries stable IDs and does not drop a new in-flight message",async()=>{
  const originalFetch=globalThis.fetch;
  const values=new Map<string,string>();
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v)}});
  Object.defineProperty(globalThis,"window",{configurable:true,value:new EventTarget()});
  const key="zyron.pending-history.v1";
  try {
    globalThis.fetch=async()=>new Response("unavailable",{status:503});
    queueJournal("user","Prefiero respuestas breves","first");
    await new Promise(r=>setTimeout(r,5));
    const original=JSON.parse(values.get(key)!)[0];
    assert.equal(original.id,"web:first:user");
    let release!:()=>void;
    const gate=new Promise<void>(r=>{release=r;});
    const batches:any[]=[];
    globalThis.fetch=async(_url,options)=>{
      batches.push(JSON.parse(String(options?.body)).entries);
      if(batches.length===1)await gate;
      return Response.json({ok:true});
    };
    const flushing=flushJournal();
    queueJournal("assistant","Entendido","second");
    release();await flushing;
    assert.equal(batches[0][0].id,original.id);
    assert.equal(batches[1][0].id,"web:second:assistant");
    assert.deepEqual(JSON.parse(values.get(key)!),[]);
  }finally{globalThis.fetch=originalFetch;delete (globalThis as any).window;delete (globalThis as any).localStorage;}
});
