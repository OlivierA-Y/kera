import {createApp} from '../server.mjs';
const hosts=[process.env.VERCEL_URL,process.env.VERCEL_PROJECT_PRODUCTION_URL,process.env.VERCEL_BRANCH_URL].filter(Boolean);
const custom=(process.env.KERA_ALLOWED_ORIGINS||'').split(',').map(value=>value.trim()).filter(Boolean);
const app=createApp({allowedOrigins:[...new Set([...hosts.map(host=>'https://'+host),...custom])]});
const endpoints={status:'/api/vision/status',analyze:'/api/vision/analyze',average:'/api/scans/average'};
export default async function handler(req,res){
  const url=new URL(req.url,'https://kera.invalid');
  const endpoint=url.searchParams.get('endpoint')||req.query?.endpoint;
  if(endpoints[endpoint])req.url=endpoints[endpoint];
  await new Promise(resolve=>{res.once('finish',resolve);res.once('close',resolve);app.emit('request',req,res);});
}
