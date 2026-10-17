const HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer"};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const ALPHABET="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function decode58(s){let n=0n;for(const c of s){const i=ALPHABET.indexOf(c);if(i<0)throw Error("Invalid base58");n=n*58n+BigInt(i)}let bytes=[];while(n>0n){bytes.push(Number(n&255n));n>>=8n}bytes.reverse();let zeros=0;while(zeros<s.length&&s[zeros]==="1")zeros++;return new Uint8Array([...new Array(zeros).fill(0),...bytes])}
function decode64(s){if(typeof s!=="string"||s.length>512||!/^[A-Za-z0-9+/]+={0,2}$/.test(s))throw Error("Invalid signature encoding");const raw=atob(s);return Uint8Array.from(raw,c=>c.charCodeAt(0))}
async function sha256(s){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,"0")).join("")}
export async function onRequestPost({request,env}){
 const url=new URL(request.url),origin=request.headers.get("origin");if(origin&&origin!==url.origin)return json({ok:false,error:"Cross-origin request denied."},403);
 if(!env?.LIVE_DB)return json({ok:false,error:"LIVE_DB D1 binding is missing."},503);
 let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid JSON."},400)}
 const wallet=String(body?.wallet||""),nonce=String(body?.nonce||""),signature=body?.signature;
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)||!/^[a-f0-9]{48}$/.test(nonce)||typeof signature!=="string")return json({ok:false,error:"Invalid wallet verification payload."},400);
 let challenge;try{challenge=await env.LIVE_DB.prepare("SELECT message,expires_at FROM live_auth_challenges WHERE nonce=? AND wallet_address=?").bind(nonce,wallet).first()}catch{return json({ok:false,error:"Live auth tables are missing. Run migrations/0002_live_auth.sql."},503)}
 if(!challenge||Number(challenge.expires_at)<Date.now())return json({ok:false,error:"Challenge expired or already used. Reconnect the wallet and retry."},401);
 let verified=false;try{const key=decode58(wallet),sig=decode64(signature);if(key.length!==32||sig.length!==64)throw Error("Bad key or signature size");const publicKey=await crypto.subtle.importKey("raw",key,{name:"Ed25519"},false,["verify"]);verified=await crypto.subtle.verify({name:"Ed25519"},publicKey,sig,new TextEncoder().encode(challenge.message))}catch{verified=false}
 if(!verified)return json({ok:false,error:"Wallet signature verification failed. No transaction was sent."},401);
 const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");
 const expires=Date.now()+12*60*60*1000;
 try{
  await env.LIVE_DB.prepare("DELETE FROM live_auth_challenges WHERE nonce=?").bind(nonce).run();
  await env.LIVE_DB.prepare("DELETE FROM live_auth_sessions WHERE expires_at < ?").bind(Date.now()).run();
  await env.LIVE_DB.prepare("INSERT INTO live_auth_sessions(token_hash,wallet_address,expires_at) VALUES(?,?,?)").bind(await sha256(token),wallet,expires).run();
 }catch{return json({ok:false,error:"Could not create a Live Trader session."},503)}
 return json({ok:true,token,expiresAt:expires,wallet});
}
export function onRequest({request,env}){return request.method==="POST"?onRequestPost({request,env}):json({ok:false,error:"Method not allowed."},405)}
