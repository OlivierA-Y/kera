/** Local-only server for static Kera + optional opt-in visual observations. Node >=22. */
import { createServer, request as httpRequest } from 'node:http';
import { createApp as createOriginalDemo } from './demo-original/server.mjs';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { analyzePhotos, validateObservation, VisionError } from './server/vision.mjs';
import { averageReadings, MAX_AVERAGE_BODY } from './server/averaging.mjs';
import { validateProfileContext, analyzeHbContext } from './server/context.mjs';
import { validateInsights } from './dist/health-context.js';
import { openRecords, recordsAPI } from './server/records.mjs';

const ROOT = fileURLToPath(new URL('./dist/', import.meta.url));
const MAX_BODY = 5_000_000;
export const DEMO_UI_HEAD = '<script src="/demo-session.js" data-demo-ui-overlay></script>';
const DEFAULT_MODEL = 'google/gemini-2.5-flash';
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };
const LIMITATION = 'Experimental skin and nail review, not a diagnosis. Photos cannot confirm or rule out skin cancer, fungal infection, eczema or psoriasis. A clinician must assess concerning changes.';
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });res.end(JSON.stringify(value));
}
async function readJson(req, { maxBody=MAX_BODY, tooLarge='The photos are too large. Use smaller images.', invalidJson='The image request could not be read.' }={}) {
  let size=0;const buffers=[];
  for await (const buffer of req.iterator({destroyOnReturn:false})) {
    size+=buffer.length;
    if (size>maxBody) { req.resume();throw new VisionError(413,'too_large',tooLarge); }
    buffers.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(buffers).toString('utf8')); }
  catch { throw new VisionError(400,'invalid_json',invalidJson); }
}
export function validateInput(body) {
  if (body?.consent !== true) throw new VisionError(400,'consent_required','Permission is required before photos can be sent for visual analysis.');
  if (!Array.isArray(body.photos) || body.photos.length<1 || body.photos.length>2) throw new VisionError(400,'invalid_photos','Send one top view and, optionally, one side view.');
  const seen=new Set();
  for (const photo of body.photos) {
    if (!photo || !['top','side'].includes(photo.view) || seen.has(photo.view) || typeof photo.data_url!=='string') throw new VisionError(400,'invalid_photos','Each photo needs a unique top or side view.');
    seen.add(photo.view);
    const match=/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo.data_url);
    if (!match || match[1].length>2_500_000 || match[1].length%4!==0) throw new VisionError(400,'invalid_image','Send a valid JPEG image under 1.8 MB per view.');
    const bytes=Buffer.from(match[1],'base64');
    if (bytes.length<100 || bytes.length>1_875_000 || bytes[0]!==0xff || bytes[1]!==0xd8 || bytes.at(-2)!==0xff || bytes.at(-1)!==0xd9 || bytes.toString('base64')!==match[1]) throw new VisionError(400,'invalid_image','One of the photos is not a supported JPEG.');
  }
  if (!seen.has('top')) throw new VisionError(400,'top_required','Include a top view of the nail.');
  return body.photos.map(({view,data_url})=>({view,data_url}));
}
export function createApp({ apiKey=process.env.OPENROUTER_API_KEY||'', model=process.env.OPENROUTER_VISION_MODEL||DEFAULT_MODEL, provider=analyzePhotos, allowDataCollection=process.env.OPENROUTER_ALLOW_DATA_COLLECTION==='true', maxRequests=10, timeoutMs=45000, contextProvider=analyzeHbContext, demoProvider, dataPath=process.env.KERA_DATA_PATH||fileURLToPath(new URL('./.data/kera.sqlite',import.meta.url)) }={}) {
  let active=0;let recent=[];let records=null;let demo=null,demoReady=null;
  function getDemo(){if(!demoReady){demo=createOriginalDemo({apiKey,model,allowDataCollection,maxRequests,timeoutMs,...(demoProvider?{provider:demoProvider}:{})});demoReady=new Promise((resolve,reject)=>{demo.once('error',reject);demo.listen(0,'127.0.0.1',()=>resolve(demo));});}return demoReady;}
  const server=createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy','same-origin');
    res.setHeader('Permissions-Policy','camera=(self), microphone=()');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      // Reject DNS rebinding and cross-origin access to this credential-bearing local server.
      const host=req.headers.host;
      if (!host || !new Set([`localhost:${server.address().port}`,`127.0.0.1:${server.address().port}`,`[::1]:${server.address().port}`]).has(host)) throw new VisionError(403,'invalid_host','This local server accepts localhost requests only.');
      const url=new URL(req.url,`http://${host}`);
      if(url.pathname==='/demo'){res.writeHead(302,{Location:'/demo/'});res.end();return;}
      if(url.pathname.startsWith('/demo/')){
        if(req.headers.origin && req.headers.origin!==`http://${host}` || req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site']))throw new VisionError(403,'cross_origin','Open Demo from the Kera app.');
        if(url.pathname==='/demo/api/vision/status'&&req.method==='GET')return json(res,200,{configured:Boolean(apiKey),provider:'OpenRouter',model:apiKey?model:null,dataCollection:allowDataCollection?'allowed':'denied',privacy:'Photos are sent only after permission. Completed results are saved to Demo history on this local server, without photos.'});
        // All audiences share both reference workflows. Guest APIs remain isolated.
        if(!url.pathname.startsWith('/demo/api/')){
          if(!['GET','HEAD'].includes(req.method))throw new VisionError(405,'method_not_allowed','This method is not supported.');
          let decoded;try{decoded=decodeURIComponent(url.pathname.slice('/demo'.length));}catch{throw new VisionError(400,'invalid_path','Invalid path.');}
          const target=path.resolve(ROOT,'.'+(decoded==='/'?'/index.html':decoded));
          if(!target.startsWith(ROOT)||decoded.split('/').some(part=>part.startsWith('.')))throw new VisionError(404,'not_found','File not found.');
          let actual,bytes;try{actual=await realpath(target);if(!actual.startsWith(ROOT))throw Error();bytes=await readFile(actual);}catch{throw new VisionError(404,'not_found','File not found.');}
          if(decoded==='/'||decoded==='/index.html')bytes=Buffer.from(bytes.toString('utf8').replace('</head>',DEMO_UI_HEAD+'</head>'));
          res.writeHead(200,{'Content-Type':MIME[path.extname(actual)]||'application/octet-stream','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:bytes);return;
        }
        const original=await getDemo(),port=original.address().port,internalHost=`127.0.0.1:${port}`;
        const headers={...req.headers,host:internalHost,...(req.headers.origin?{origin:`http://${internalHost}`}:{})};
        const upstream=httpRequest({host:'127.0.0.1',port,path:req.url.slice('/demo'.length),method:req.method,headers},response=>{
          if(req.method==='GET'&&response.statusCode===200&&['/demo/','/demo/index.html'].includes(url.pathname)){
            const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{const html=Buffer.concat(chunks).toString('utf8').replace('</head>',DEMO_UI_HEAD+'</head>');const outputHeaders={...response.headers,'content-length':Buffer.byteLength(html),'cache-control':'no-store'};delete outputHeaders['transfer-encoding'];res.writeHead(200,outputHeaders);res.end(html);});
          }else{res.writeHead(response.statusCode,response.headers);response.pipe(res);}
        });
        upstream.on('error',()=>{if(!res.headersSent)json(res,502,{error:{code:'demo_unavailable',message:'The original Demo could not be reached. Reload to retry.'}});else res.destroy();});
        res.on('close',()=>{if(!res.writableEnded)upstream.destroy();});req.pipe(upstream);return;
      }
      if (url.pathname==='/api/scans/average') {
        if (req.method!=='POST') throw new VisionError(405,'method_not_allowed','Use POST to average scans.');
        if (req.headers.origin!==`http://${host}` || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site']!=='same-origin')) throw new VisionError(403,'cross_origin','Scan averaging must start from this app.');
        if (req.headers['content-type']?.split(';')[0].trim()!=='application/json') throw new VisionError(415,'invalid_type','Use a JSON scan request.');
        if (Number(req.headers['content-length']||0)>MAX_AVERAGE_BODY) throw new VisionError(413,'too_large','The scan request is too large. Send at most 100 short readings.');
        const body=await readJson(req,{maxBody:MAX_AVERAGE_BODY,tooLarge:'The scan request is too large. Send at most 100 short readings.',invalidJson:'The scan request could not be read.'});
        return json(res,200,averageReadings(body));
      }
      if (url.pathname==='/api/vision/status' && req.method==='GET') return json(res,200,{configured:Boolean(apiKey),provider:'OpenRouter',model:apiKey?model:null,dataCollection:allowDataCollection?'allowed':'denied',privacy:'Photos are sent through OpenRouter to its selected model provider only after explicit permission. Kera saves completed structured results to the selected profile, without saving photos.'});
      if (url.pathname==='/api/vision/analyze') {
        if (req.method!=='POST') throw new VisionError(405,'method_not_allowed','Use POST for visual analysis.');
        if (req.headers.origin!==`http://${host}` || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site']!=='same-origin')) throw new VisionError(403,'cross_origin','Visual analysis must start from this app.');
        if (req.headers['content-type']?.split(';')[0].trim()!=='application/json') throw new VisionError(415,'invalid_type','Use a JSON image request.');
        if (Number(req.headers['content-length']||0)>MAX_BODY) throw new VisionError(413,'too_large','The photos are too large.');
        const body=await readJson(req);const photos=validateInput(body);
        const profileContext=body.profile_context===undefined?null:validateProfileContext(body.profile_context);
        if(profileContext&&body.context_consent!==true)throw new VisionError(400,'context_consent_required','Confirm sharing the displayed background.');
        if (!apiKey) throw new VisionError(503,'not_configured','Visual analysis is not connected on this server yet. Hemoglobin estimation still works on your device.');
        recent=recent.filter(time=>Date.now()-time<60000);
        if (recent.length>=maxRequests || active>=1) throw new VisionError(429,'local_limit','Please wait before starting another visual analysis.');
        recent.push(Date.now());active++;
        const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
        const disconnected=()=>{if(!res.writableEnded)controller.abort();};res.on('close',disconnected);
        try {
          const raw=await provider(photos,{apiKey,model,allowDataCollection,signal:controller.signal,profileContext});
          const observation=validateObservation({image_quality:raw.image_quality,observations:raw.observations},photos.some(p=>p.view==='side'));
          let contextInsights=null;if(profileContext&&raw.context_insights){try{contextInsights=validateInsights(raw.context_insights);}catch{}}
          if (controller.signal.aborted) throw new VisionError(504,'provider_timeout','The vision request timed out or was canceled.');
          if (!res.destroyed) json(res,200,{...observation,...(contextInsights?{context_insights:contextInsights}:profileContext?{context_warning:'Background insights were unavailable. The visual observations are unchanged.'}:{}),provider:'OpenRouter',model,limitation:LIMITATION,analysis_id:randomUUID()});
        } catch(e) {
          if(controller.signal.aborted)throw new VisionError(504,'provider_timeout','The vision request timed out or was canceled.');
          throw e;
        } finally { clearTimeout(timer);res.off('close',disconnected);active--; }
        return;
      }
      if(url.pathname==='/api/context/hb'){
        if(req.method!=='POST')throw new VisionError(405,'method_not_allowed','Use POST for background insights.');
        if(req.headers.origin!==`http://${host}` || req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin')throw new VisionError(403,'cross_origin','Generate insights from Kera.');
        if(req.headers['content-type']?.split(';')[0].trim()!=='application/json')throw new VisionError(415,'invalid_type','Use JSON.');
        const body=await readJson(req,{maxBody:12000,tooLarge:'The background is too long.',invalidJson:'The background could not be read.'});
        if(body?.consent!==true)throw new VisionError(400,'consent_required','Confirm sharing the displayed background.');
        const profileContext=validateProfileContext(body.profile_context);
        if(!Number.isFinite(body.hemoglobin_g_per_l)||body.hemoglobin_g_per_l<=0||body.hemoglobin_g_per_l>1000)throw new VisionError(400,'invalid_estimate','Use a completed Hb estimate.');
        if(!apiKey)throw new VisionError(503,'not_configured','AI background insights are not connected. The estimate and reference context remain available.');
        recent=recent.filter(t=>Date.now()-t<60000);if(active>=1||recent.length>=maxRequests)throw new VisionError(429,'local_limit','Please wait before generating more insights.');recent.push(Date.now());active++;
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);const disconnected=()=>{if(!res.writableEnded)controller.abort();};res.on('close',disconnected);
        try{const insights=validateInsights(await contextProvider(profileContext,body.hemoglobin_g_per_l,{apiKey,model,allowDataCollection,signal:controller.signal}));if(controller.signal.aborted)throw new VisionError(504,'provider_timeout','Background insights timed out.');if(!res.destroyed)json(res,200,{insights,provider:'OpenRouter',model});}finally{active--;clearTimeout(timer);res.off('close',disconnected);}return;
      }
      if (/^\/api\/(demo-workspace|accounts|account|profiles|results|organizations|invitations|invitation|memberships|backup|restore)(\/|$)/.test(url.pathname)) {
        if (req.headers.origin && req.headers.origin!==`http://${host}` || req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site'])) throw new VisionError(403,'cross_origin','Open records from the Kera app.');
        let body;
        if (!['GET','HEAD'].includes(req.method)) {
          if (req.headers.origin!==`http://${host}`) throw new VisionError(403,'cross_origin','Record changes must start from the Kera app.');
          if (req.method!=='DELETE' && req.headers['content-type']?.split(';')[0].trim()!=='application/json') throw new VisionError(415,'invalid_type','Use a JSON record request.');
          if (req.method!=='DELETE') body=await readJson(req,{maxBody:url.pathname==='/api/restore'?8_000_000:150_000,tooLarge:'The record or backup is too large.',invalidJson:'The record could not be read.'});
        }
        records ||= openRecords(dataPath);
        return json(res,200,recordsAPI(records,req,url,body));
      }
      if (url.pathname.startsWith('/api/')) throw new VisionError(404,'not_found','This endpoint does not exist.');
      if (!['GET','HEAD'].includes(req.method)) throw new VisionError(405,'method_not_allowed','This method is not supported.');
      let decoded;
      try{decoded=decodeURIComponent(url.pathname);}catch{throw new VisionError(400,'invalid_path','Invalid path.');}
      const target=path.resolve(ROOT,'.'+(decoded==='/'?'/index.html':decoded));
      if (!target.startsWith(ROOT)||decoded.split('/').some(part=>part.startsWith('.'))) throw new VisionError(404,'not_found','File not found.');
      let actual,bytes;
      try{actual=await realpath(target);if(!actual.startsWith(ROOT))throw new Error('outside');bytes=await readFile(actual);}catch{throw new VisionError(404,'not_found','File not found.');}
      res.writeHead(200,{'Content-Type':MIME[path.extname(actual)]||'application/octet-stream','Cache-Control':path.extname(actual)==='.html'?'no-store':'no-cache'});
      res.end(req.method==='HEAD'?undefined:bytes);
    } catch(e) {
      if (res.destroyed || res.writableEnded) return;
      // Never forward raw provider exceptions, request bodies, or credentials.
      json(res,e instanceof VisionError?e.status:500,{error:{code:e instanceof VisionError?e.code:'internal_error',message:e instanceof VisionError?e.message:'Visual analysis could not complete. Try again.'}});
    }
  });
  server.on('close',()=>{records?.close();if(demo){demo.closeAllConnections();demo.close();}});
  server.requestTimeout=55000;server.headersTimeout=10000;
  return server;
}
if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try{process.loadEnvFile(fileURLToPath(new URL('./.env',import.meta.url)));}catch(e){if(e.code!=='ENOENT')throw e;}
  const host=process.env.HOST||'127.0.0.1';
  if (!['127.0.0.1','localhost','::1'].includes(host)) throw new Error('This server is local-only. Use a properly authenticated deployment before exposing it publicly.');
  const port=Number(process.env.PORT||4173);
  if (!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be a valid port number.');
  const app=createApp();
  app.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} is already in use. Stop the old preview server or choose another PORT.`:'The local server could not start.');process.exitCode=1;});
  app.listen(port,host,()=>console.log(`Kera: http://localhost:${port}\nVisual observations: ${process.env.OPENROUTER_API_KEY?'connected to OpenRouter':'not configured (set OPENROUTER_API_KEY in web/.env)'}`));
}
