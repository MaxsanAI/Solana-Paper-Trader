const HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer"};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
async function hash(s){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,"0")).join("")}
async function walletFor(request,env){const h=request.headers.get("authorization")||"",m=h.match(/^Bearer ([a-f0-9]{64})$/);if(!m||!env?.LIVE_DB)return null;const row=await env.LIVE_DB.prepare("SELECT wallet_address,expires_at FROM live_auth_sessions WHERE token_hash=?").bind(await hash(m[1])).first();if(!row||Number(row.expires_at)<Date.now())return null;return row.wallet_address}
function validMint(s){return typeof s==="string"&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)}
function num(v,min=0,max=1e15){const n=Number(v);return Number.isFinite(n)&&n>=min&&n<=max?n:null}
export async function onRequestGet({request,env}){if(!env?.LIVE_DB)return json({ok:false,error:"LIVE_DB D1 binding is missing."},503);let wallet;try{wallet=await walletFor(request,env)}catch{return json({ok:false,error:"Live session tables missing or unavailable."},503)}if(!wallet)return json({ok:false,error:"Connect and verify your wallet to load Live Trader data."},401);
 try{const [p,h,s]=await Promise.all([
 env.LIVE_DB.prepare("SELECT token_mint,token_symbol,token_amount_raw,entry_price_usd,last_price_usd,take_profit_pct,stop_loss_pct,cost_sol,cost_usd,entry_sol_usd,status,opened_at,updated_at,closed_at FROM live_positions WHERE wallet_address=? AND status='open'").bind(wallet).all(),
 env.LIVE_DB.prepare("SELECT id,token_mint,token_symbol,side,value_usd,pnl_usd,sol_amount,price_usd,tx_signature,reason,created_at FROM live_trade_events WHERE wallet_address=? ORDER BY created_at DESC LIMIT 200").bind(wallet).all(),
 env.LIVE_DB.prepare("SELECT take_profit_pct,stop_loss_pct,auto_exit_enabled FROM live_trader_settings WHERE wallet_address=?").bind(wallet).first()
 ]);
 return json({ok:true,wallet,positions:p.results||[],history:h.results||[],settings:s||{take_profit_pct:0,stop_loss_pct:0,auto_exit_enabled:0}});
 }catch{return json({ok:false,error:"Could not read Live Trader records from D1."},503)}}
export async function onRequestPost({request,env}){const url=new URL(request.url),origin=request.headers.get("origin");if(origin&&origin!==url.origin)return json({ok:false,error:"Cross-origin request denied."},403);if(!env?.LIVE_DB)return json({ok:false,error:"LIVE_DB D1 binding is missing."},503);let wallet;try{wallet=await walletFor(request,env)}catch{return json({ok:false,error:"Live session tables missing or unavailable."},503)}if(!wallet)return json({ok:false,error:"Live wallet session expired. Reconnect and verify your wallet."},401);
 let b;try{b=await request.json()}catch{return json({ok:false,error:"Invalid JSON."},400)}
 const action=String(b?.action||"");
 try{
 if(action==="save-position"){
  const p=b.position||{},mint=p.mint,symbol=String(p.symbol||"TOKEN").slice(0,24),amount=String(p.amountRaw||"0");
  if(!validMint(mint)||!/^[0-9]{1,80}$/.test(amount)||BigInt(amount)<=0n)return json({ok:false,error:"Invalid live position data."},400);
  const entry=num(p.entryPrice,0.000000000001),last=num(p.lastPrice,0),tp=num(p.tp,0,10000),sl=num(p.sl,0,100),costSol=num(p.costSol,0,1000),costUsd=num(p.costUsd,0,1e9),entrySolUsd=num(p.entrySolUsd,0,1e7);
  if([entry,last,tp,sl,costSol,costUsd,entrySolUsd].some(x=>x===null))return json({ok:false,error:"Live position contains invalid numeric values."},400);
  await env.LIVE_DB.prepare("INSERT INTO live_positions(wallet_address,token_mint,token_symbol,token_amount_raw,entry_price_usd,last_price_usd,take_profit_pct,stop_loss_pct,cost_sol,cost_usd,entry_sol_usd,status,opened_at,updated_at,closed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'open',datetime('now'),datetime('now'),NULL) ON CONFLICT(wallet_address,token_mint) DO UPDATE SET token_symbol=excluded.token_symbol,token_amount_raw=excluded.token_amount_raw,entry_price_usd=excluded.entry_price_usd,last_price_usd=excluded.last_price_usd,take_profit_pct=excluded.take_profit_pct,stop_loss_pct=excluded.stop_loss_pct,cost_sol=excluded.cost_sol,cost_usd=excluded.cost_usd,entry_sol_usd=excluded.entry_sol_usd,status='open',updated_at=datetime('now'),closed_at=NULL").bind(wallet,mint,symbol,amount,entry,last,tp,sl,costSol,costUsd,entrySolUsd).run();
  return json({ok:true});
 }
 if(action==="close-position"){
  const mint=b.mint;if(!validMint(mint))return json({ok:false,error:"Invalid token mint."},400);
  const tx=String(b.signature||"").slice(0,120),symbol=String(b.symbol||"TOKEN").slice(0,24),side=b.side==="SELL"?"SELL":"BUY";
  const value=num(b.valueUsd,0,1e9),pnl=b.pnlUsd==null?null:num(b.pnlUsd,-1e9,1e9),sol=num(b.solAmount,0,1e6),px=num(b.priceUsd,0,1e12);
  if(value===null||(pnl===null&&b.pnlUsd!=null)||sol===null||px===null)return json({ok:false,error:"Invalid trade event values."},400);
  if(side==="SELL")await env.LIVE_DB.prepare("UPDATE live_positions SET status='closed',updated_at=datetime('now'),closed_at=datetime('now') WHERE wallet_address=? AND token_mint=?").bind(wallet,mint).run();
  await env.LIVE_DB.prepare("INSERT INTO live_trade_events(id,wallet_address,token_mint,token_symbol,side,value_usd,pnl_usd,sol_amount,price_usd,tx_signature,reason) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(),wallet,mint,symbol,side,value,pnl,sol,px,tx,String(b.reason||"").slice(0,120)).run();
  return json({ok:true});
 }
 if(action==="save-settings"){
  const tp=num(b.takeProfitPct,0,10000),sl=num(b.stopLossPct,0,100),auto=b.autoExitEnabled===true?1:0;if(tp===null||sl===null)return json({ok:false,error:"Invalid TP/SL values."},400);
  await env.LIVE_DB.prepare("INSERT INTO live_trader_settings(wallet_address,take_profit_pct,stop_loss_pct,auto_exit_enabled,updated_at) VALUES(?,?,?,?,datetime('now')) ON CONFLICT(wallet_address) DO UPDATE SET take_profit_pct=excluded.take_profit_pct,stop_loss_pct=excluded.stop_loss_pct,auto_exit_enabled=excluded.auto_exit_enabled,updated_at=datetime('now')").bind(wallet,tp,sl,auto).run();return json({ok:true});
 }
 return json({ok:false,error:"Unknown Live Trader action."},400);
 }catch{return json({ok:false,error:"Could not save Live Trader data in D1."},503)}
}
export function onRequest({request,env}){if(request.method==="GET")return onRequestGet({request,env});if(request.method==="POST")return onRequestPost({request,env});return json({ok:false,error:"Method not allowed."},405)}
