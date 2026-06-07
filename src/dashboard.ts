// Live terminal dashboard: one row per account, redrawn in place. Detailed
// logs still go to logs/bot.log; this is for at-a-glance monitoring.

export interface Row {
  name: string;
  party: string;
  phase: string;
  quests: string; // "2/3"
  swaps: number;
  bal: string; // all token balances (unlocked + locked)
  note: string;
  state: "idle" | "busy" | "wait" | "done" | "error";
}

const COLOR: Record<Row["state"], string> = {
  idle: "\x1b[90m",
  busy: "\x1b[36m",
  wait: "\x1b[33m",
  done: "\x1b[32m",
  error: "\x1b[31m",
};
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));

export class Dashboard {
  private rows = new Map<string, Row>();
  private timer?: NodeJS.Timeout;
  private lastLines = 0;
  private title: string;
  private startedAt = Date.now();

  constructor(title: string, names: string[]) {
    this.title = title;
    for (const name of names) {
      this.rows.set(name, {
        name,
        party: "",
        phase: "queued",
        quests: "-",
        swaps: 0,
        bal: "-",
        note: "",
        state: "idle",
      });
    }
  }

  set(name: string, partial: Partial<Row>): void {
    const row = this.rows.get(name);
    if (row) Object.assign(row, partial);
  }

  start(): void {
    process.stdout.write("\x1b[?25l"); // hide cursor
    this.render();
    this.timer = setInterval(() => this.render(), 700);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.render();
    process.stdout.write("\x1b[?25h\n"); // show cursor
  }

  private render(): void {
    const elapsed = Math.floor((Date.now() - this.startedAt) / 1000);
    const W = { name: 10, party: 8, state: 7, quests: 7, swaps: 6, phase: 34 };
    const header =
      `${DIM}${pad("ACCOUNT", W.name)} ${pad("PARTY", W.party)} ${pad("STATE", W.state)} ` +
      `${pad("QUESTS", W.quests)} ${pad("SWAPS", W.swaps)} ${pad("PHASE", W.phase)}${RESET}`;

    const lines = [`\x1b[1m🛰  ${this.title}${RESET}  ${DIM}(${elapsed}s)${RESET}`, header];
    for (const r of this.rows.values()) {
      const c = COLOR[r.state];
      lines.push(
        `${pad(r.name, W.name)} ${DIM}${pad(r.party, W.party)}${RESET} ${c}${pad(r.state.toUpperCase(), W.state)}${RESET} ` +
          `${pad(r.quests, W.quests)} ${pad(String(r.swaps), W.swaps)} ${c}${pad(r.phase + (r.note ? " — " + r.note : ""), W.phase)}${RESET}`,
      );
      // second line: full balances (all tokens, unlocked + locked), not truncated
      lines.push(`${DIM}   └ bal: ${r.bal}${RESET}`);
    }

    // redraw in place
    if (this.lastLines > 0) process.stdout.write(`\x1b[${this.lastLines}A`);
    process.stdout.write(lines.map((l) => "\x1b[2K" + l).join("\n") + "\n");
    this.lastLines = lines.length;
  }
}
