#!/usr/bin/env bash
cd /home/gosjavar/bot-erdrop/kairo
export LD_LIBRARY_PATH=$HOME/chrome-libs/usr/lib/x86_64-linux-gnu:$HOME/chrome-libs/opt/google/chrome:$LD_LIBRARY_PATH

probe() {
node -e '
import("playwright").then(async ({chromium})=>{
  const b=await chromium.connectOverCDP("http://localhost:9222");
  const ctx=b.contexts()[0];const page=ctx.pages().find(p=>p.url().includes("kairo.ag"))||ctx.pages()[0];
  const o=await page.evaluate(async ()=>{
    const at=localStorage.getItem("authToken"),pid=localStorage.getItem("partyId");
    const H={Authorization:`Bearer ${at}`,"Content-Type":"application/json"};
    const bal=(await (await fetch("https://api.kairo.ag/swap/token-balance?partyId="+encodeURIComponent(pid),{headers:H})).json()).data;
    const cc=(bal.find(x=>x.instrumentId.id==="Amulet")||{}).unlocked||"0";
    return {cc};
  });
  console.log(o.cc);await b.close();
});' 2>/dev/null | grep -v dbus | tail -1
}

for i in $(seq 1 40); do
  U=$(probe); echo "[poll $i] unlocked CC=$U"
  awk "BEGIN{exit !($U >= 11)}" && break
  sleep 25
done

echo "=== window open, prepare-only probes ==="
node -e '
import("playwright").then(async ({chromium})=>{
  const b=await chromium.connectOverCDP("http://localhost:9222");
  const ctx=b.contexts()[0];const page=ctx.pages().find(p=>p.url().includes("kairo.ag"))||ctx.pages()[0];
  const o=await page.evaluate(async ()=>{
    const at=localStorage.getItem("authToken"),pid=localStorage.getItem("partyId");
    const H={Authorization:`Bearer ${at}`,"Content-Type":"application/json"};
    const prep=async(out,amt)=>{const r=await fetch("https://api.kairo.ag/swap/simple-escrow/prepare",{method:"POST",headers:H,body:JSON.stringify({trader:pid,inputAmount:amt,inputTokenType:"Amulet",outputTokenType:out})});const t=await r.text();return r.status+" "+t.slice(0,90);};
    const bal=(await (await fetch("https://api.kairo.ag/swap/token-balance?partyId="+encodeURIComponent(pid),{headers:H})).json()).data;
    return {cc:(bal.find(x=>x.instrumentId.id==="Amulet")||{}).unlocked,cbtc:await prep("CBTC","10"),usdc:await prep("USDCx","10")};
  });
  console.log("unlocked CC at probe:",o.cc);
  console.log("CBTC prepare:",o.cbtc);
  console.log("USDCx prepare:",o.usdc);
  await b.close();
});' 2>/dev/null | grep -v dbus
