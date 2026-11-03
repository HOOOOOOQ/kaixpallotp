// Vercel hosts only the public frontend and this same-origin API proxy.
// The application backend and database are deployed separately.
const allowedHeaders = ['authorization','cookie','content-type','origin','x-csrf-token'];
const fail = (res, status, message) => {res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify({error:message}));};

export async function proxy(req,res,{fetchImpl=fetch,backendUrl=process.env.BACKEND_URL}={}) {
  res.setHeader('Cache-Control','no-store');
  if (!['GET','HEAD','POST'].includes(req.method)) {res.setHeader('Allow','GET, HEAD, POST');return fail(res,405,'Method not allowed.');}
  let backend;
  try {
    backend=new URL(backendUrl);
    if(backend.protocol!=='https:'||backend.username||backend.password||backend.search||backend.hash||backend.pathname!=='/') throw Error('invalid');
  } catch {return fail(res,503,'Backend is not configured.');}
  const incoming=new URL(req.url,'http://internal');
  const requested=req.query?.__p ?? incoming.searchParams.get('__p');
  if(typeof requested!=='string'||requested.length>512||!/^[-A-Za-z0-9_]+(?:\/[-A-Za-z0-9_]+)*$/.test(requested)) return fail(res,400,'Invalid API path.');
  const url=new URL(`/api/${requested}`,backend);
  for(const [key,value] of incoming.searchParams) if(key!=='__p') url.searchParams.append(key,value);
  const headers={};for(const name of allowedHeaders) if(typeof req.headers[name]==='string')headers[name]=req.headers[name];
  let body;
  try {
    if(req.method==='POST') {
      if(req.body!==undefined) body=Buffer.isBuffer(req.body)?req.body:Buffer.from(typeof req.body==='string'?req.body:JSON.stringify(req.body));
      else {const chunks=[];let total=0;for await(const chunk of req){total+=chunk.length;if(total>16384)return fail(res,413,'Request too large.');chunks.push(chunk);}body=Buffer.concat(chunks);}
      if(body.length>16384)return fail(res,413,'Request too large.');
    }
    const response=await fetchImpl(url,{method:req.method,headers,body,redirect:'manual',signal:AbortSignal.timeout(12000)});
    if(response.status>=300&&response.status<400)return fail(res,502,'Backend returned an unexpected redirect.');
    const contentLength=Number(response.headers.get('content-length'));
    if(Number.isFinite(contentLength)&&contentLength>1048576)return fail(res,502,'Backend response too large.');
    const chunks=[];let size=0;
    if(response.body){const reader=response.body.getReader();while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576){await reader.cancel();return fail(res,502,'Backend response too large.');}chunks.push(Buffer.from(value));}}
    const cookies=response.headers.getSetCookie?.()||[];if(cookies.length)res.setHeader('Set-Cookie',cookies);
    for(const name of ['content-type','retry-after','allow']) {const value=response.headers.get(name);if(value)res.setHeader(name,value);}
    res.statusCode=response.status;return res.end(req.method==='HEAD'?undefined:Buffer.concat(chunks));
  } catch {return fail(res,502,'Backend unavailable.');}
}
export default function handler(req,res){return proxy(req,res);}
