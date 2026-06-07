// Rich live dashboard: per-account cards + scrolling activity feed.
// Detailed logs still go to logs/bot.log; this is the at-a-glance monitor.

export type Kind = "proxy" | "balance" | "swap" | "done" | "error" | "info";

export interface AcctView {
  name: string;
  party: string;
  cnt: string; // count quest "5/5" or "-"
  cb: "Y" | "N" | "-"; // CC<->CBTC quest
  ux: "Y" | "N" | "-"; // CC<->USDCx quest
  swOk: number;
  swFail: number;
  cc: string; // formatted CC balance (with +NL if locked)
  uxBal: string;
  cbBal: string;
  status: string;
  state: "idle" | "busy" | "wait" | "done" | "error";
}

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

const KIND_COLOR: Record<Kind, string> = {
  proxy: C.magenta,
  balance: C.cyan,
  swap: C.yellow,
  done: C.green,
  error: C.red,
  info: C.gray,
};

const STATE_COLOR: Record<AcctView["state"], string> = {
  idle: C.gray,
  busy: C.cyan,
  wait: C.yellow,
  done: C.green,
  error: C.red,
};

interface LogLine {
  t: string;
  label: string;
  msg: string;
  kind: Kind;
}

export interface DashOpts {
  swapAmt: number;
  proxied: number;
  nextRunCron?: string; // "m h * * *" for countdown
  maxLog?: number;
}

function nextRun(cron?: string): { at: Date; label: string } | null {
  if (!cron) return null;
  const m = cron.match(/^(\d+)\s+(\d+)\s/);
  if (!m) return null;
  const min = +m[1],
    hr = +m[2];
  const now = new Date();
  const at = new Date(now);
  at.setHours(hr, min, 0, 0);
  if (at <= now) at.setDate(at.getDate() + 1);
  return { at, label: `${String(hr).padStart(2, "0")}:${String(min).padStart(2, "0")}` };
}

export class Dashboard {
  private accts = new Map<string, AcctView>();
  private log: LogLine[] = [];
  private timer?: NodeJS.Timeout;
  private started = false;

  constructor(
    private title: string,
    names: string[],
    private opts: DashOpts,
  ) {
    for (const name of names) {
      this.accts.set(name, {
        name,
        party: "",
        cnt: "-",
        cb: "-",
        ux: "-",
        swOk: 0,
        swFail: 0,
        cc: "-",
        uxBal: "-",
        cbBal: "-",
        status: "queued",
        state: "idle",
      });
    }
  }

  setAcct(name: string, u: Partial<AcctView>): void {
    const a = this.accts.get(name);
    if (a) Object.assign(a, u);
  }

  addLog(label: string, msg: string, kind: Kind): void {
    const t = new Date().toTimeString().slice(0, 8);
    this.log.push({ t, label, msg, kind });
    const max = this.opts.maxLog ?? 14;
    if (this.log.length > max) this.log.shift();
  }

  start(): void {
    this.started = true;
    process.stdout.write("\x1b[2J\x1b[?25l"); // clear + hide cursor
    this.render();
    this.timer = setInterval(() => this.render(), 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.render();
    process.stdout.write("\x1b[?25h\n"); // show cursor
  }

  private render(): void {
    if (!this.started) return;
    const lines: string[] = [];
    const clock = new Date().toTimeString().slice(0, 8);
    const nr = nextRun(this.opts.nextRunCron);
    let countdown = "";
    if (nr) {
      const diff = Math.max(0, nr.at.getTime() - Date.now());
      const h = Math.floor(diff / 3600000);
      const mm = Math.floor((diff % 3600000) / 60000);
      countdown = ` • next ${nr.label} in ${h}h${mm}m`;
    }

    // header
    lines.push(`${C.bold}${C.magenta}        KAIRO BOT V1 • ${this.title.toUpperCase()}${C.reset}`);
    lines.push(
      `${C.dim}   ${this.accts.size} acct • ${C.green}LIVE${C.reset}${C.dim} • ${this.opts.proxied} proxied • ${clock}${countdown}${C.reset}`,
    );
    lines.push("");

    // cards
    for (const a of this.accts.values()) {
      const sc = STATE_COLOR[a.state];
      const head = `─ ${C.bold}${a.name}${C.reset} ${C.dim}@${this.opts.swapAmt}${a.party ? "  " + a.party : ""}${C.reset} `;
      lines.push(head + C.dim + "─".repeat(Math.max(0, 46 - a.name.length - String(this.opts.swapAmt).length)) + C.reset);
      const yn = (v: "Y" | "N" | "-") => (v === "Y" ? `${C.green}Y${C.reset}` : v === "N" ? `${C.red}N${C.reset}` : `${C.gray}-${C.reset}`);
      lines.push(
        `  CNT ${a.cnt}   CB ${yn(a.cb)}  UX ${yn(a.ux)}    ${C.dim}sw${C.reset} ${a.swOk}/${a.swFail}`,
      );
      lines.push(`  ${C.cyan}CC${C.reset} ${a.cc}   ${C.cyan}UX${C.reset} ${a.uxBal}   ${C.cyan}CB${C.reset} ${a.cbBal}`);
      lines.push(`  ${sc}> ${a.status}${C.reset}`);
    }

    // activity feed
    lines.push("");
    lines.push(`${C.dim}── ACTIVITY ──────────────────────────────${C.reset}`);
    for (const l of this.log) {
      lines.push(
        `${C.gray}${l.t}${C.reset} ${C.bold}${l.label.padEnd(3)}${C.reset} ${KIND_COLOR[l.kind]}${l.msg}${C.reset}`,
      );
    }

    process.stdout.write("\x1b[H\x1b[2J" + lines.join("\n") + "\n");
  }
}
