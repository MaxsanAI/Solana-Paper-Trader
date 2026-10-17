const HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer"};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const BASE58=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export async function onRequestPost({request,env}) {
 const url=new URL(request.url),origin=request.headers.get("origin");
 if(origin&&origin!==url.origin)return json({ok:false,error:"Cross-origin request denied."},403);
 if(!env?.LIVE_DB)return json({ok:false,error:"LIVE_DB D1 binding is missing."},503);
 let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid JSON."},400)}
 const wallet=String(body?.wallet||"");
 if(!BASE58.test(wallet))return json({ok:false,error:"Invalid wallet address."},400);
 const nonce=Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,"0")).join("");
 const issued=Date.now(),expires=issued+5*60*1000;
 const message="Solana Paper Trader Live Trader wallet verification\nWallet: "+wallet+"\nNonce: "+nonce+"\nIssued At: "+new Date(issued).toISOString()+"\nExpires At: "+new Date(expires).toISOString()+"\nPurpose: Authenticate access to this wallet's Live Trader records only.";
 try{
  await env.LIVE_DB.prepare("DELETE FROM live_auth_challenges WHERE expires_at < ?").bind(issued).run();
  await env.LIVE_DB.prepare("INSERT INTO live_auth_challenges(nonce,wallet_address,message,expires_at) VALUES(?,?,?,?)").bind(nonce,wallet,message,expires).run();
 }catch{return json({ok:false,error:"Could not save wallet challenge. Check the 0002_live_auth.sql migration."},503)}
 return json({ok:true,nonce,message,expiresAt:expires});
}
export function onRequest({request,env}){return request.method==="POST"?onRequestPost({request,env}):json({ok:false,error:"Method not allowed."},405)}
