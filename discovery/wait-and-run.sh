#!/usr/bin/env bash
# Poll unlocked CC balance; once >= 10, run the bot once to finish remaining quests.
set -e
cd /home/gosjavar/bot-erdrop/kairo
export LD_LIBRARY_PATH=$HOME/chrome-libs/usr/lib/x86_64-linux-gnu:$HOME/chrome-libs/opt/google/chrome:$LD_LIBRARY_PATH

get_unlocked() {
  node -e '
  import("playwright").then(async ({chromium})=>{
    const b=await chromium.connectOverCDP("http://localhost:9222");
    const ctx=b.contexts()[0];const page=ctx.pages().find(p=>p.url().includes("kairo.ag"))||ctx.pages()[0];
    const r=await page.evaluate(async ()=>{
      const at=localStorage.getItem("authToken"),pid=localStorage.getItem("partyId");
      const res=await fetch("https://api.kairo.ag/swap/token-balance?partyId="+encodeURIComponent(pid),{headers:{Authorization:`Bearer ${at}`}});
      const j=await res.json();
      const a=(j.data||[]).find(x=>x.instrumentId.id==="Amulet");
      return a?a.unlocked:"0";
    });
    console.log(r);await b.close();
  });' 2>/dev/null | grep -v dbus | tail -1
}

for i in $(seq 1 40); do
  U=$(get_unlocked)
  echo "[poll $i] unlocked CC = $U"
  awk "BEGIN{exit !($U >= 11)}" && { echo "enough CC, running bot"; break; }
  sleep 30
done

LOG_LEVEL=info npx tsx src/main.ts --once --account main 2>&1 | tail -5
echo "=== final quests ==="
node -e '
import("playwright").then(async ({chromium})=>{
  const b=await chromium.connectOverCDP("http://localhost:9222");
  const ctx=b.contexts()[0];const page=ctx.pages().find(p=>p.url().includes("kairo.ag"))||ctx.pages()[0];
  const r=await page.evaluate(async ()=>{
    const at=localStorage.getItem("authToken");
    const res=await fetch("https://api.kairo.ag/trader-analytics/daily-swap-activities",{headers:{Authorization:`Bearer ${at}`}});
    const j=await res.json();return j.data.summary;
  });
  console.log("SUMMARY:",JSON.stringify(r));await b.close();
});' 2>/dev/null | grep -v dbus | tail -1
