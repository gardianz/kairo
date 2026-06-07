// Build an undici Dispatcher from a proxy URL so fetch() routes through it.
// Supports HTTP/HTTPS proxies (with optional user:pass@), e.g.
//   http://user:pass@host:port   https://host:port
import { ProxyAgent, type Dispatcher } from "undici";

export function makeDispatcher(url?: string): Dispatcher | undefined {
  if (!url) return undefined;
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`unsupported proxy url "${url}" (use http:// or https://)`);
  }
  return new ProxyAgent(url);
}
