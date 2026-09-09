// nostr-sig watcher — relays kind-37500 events from Nostr to NEAR.
//
// Two event shapes:
//  A) post events — content is plain text or pipe-delimited (no quotes/backslashes)
//     tags: [t, action, nonce, expires, contract]
//  B) approval events — content is "expires {ns}.000000000: approve:..."
//     tags: [t, contract, wallet, proposal, approver, action=approve]

const GOVERNANCE_KIND = 37500;
const MAX_EVENTS = 50;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [5_000, 30_000, 300_000]; // 5s, 30s, 5min

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

interface Env {
  NEAR_ACCOUNT_ID: string;
  NEAR_SIGNER_KEY: string;
  RELAY_URLS: string;
  NEAR_RPC: string;
  TREASURY_CONTRACT_IDS: string;
  STATE_KV: KVNamespace;
}

function eventAuthFields(event: NostrEvent): Record<string, string> {
  return {
    pk: event.pubkey,
    ev: event.id,
    sig: event.sig,
    kind: String(event.kind),
    tags: JSON.stringify(event.tags),
    ct: event.content,
    cat: String(event.created_at),
  };
}

function nip01Serialize(event: NostrEvent): string {
  return JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
}

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── NEAR tx building (minimal, no SDK) ─────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  return bytes;
}

function base64UrlToBytes(b64: string): Uint8Array {
  const raw = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function buildPkcs8Ed25519(seed: Uint8Array): Uint8Array {
  const algoId = new Uint8Array([0x30, 0x2e, 0x30, 0x0d, 0x06, 0x09, 0x2b, 0x06, 0x01, 0x04, 0x01, 0xda, 0x47, 0x0f, 0x01, 0x01, 0x01, 0x05, 0x00, 0x04, 0x1d, 0x30, 0x1b, 0x02, 0x01, 0x01, 0x04, 0x20]);
  const innerOctet = new Uint8Array([0xa1, 0x22, 0x04, 0x20]);
  const inner = new Uint8Array(2 + seed.length);
  inner[0] = 0x04; inner[1] = 0x20; inner.set(seed, 2);
  const outer = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
  const result = new Uint8Array(algoId.length + inner.length + outer.length + inner.length);
  let o = 0;
  result.set(algoId, o); o += algoId.length;
  result.set(inner, o); o += inner.length;
  result.set(outer, o); o += outer.length;
  result.set(inner, o);
  return result;
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function bytesToBase58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let r = "";
  while (n > 0n) { r = BASE58[Number(n % 58n)] + r; n /= 58n; }
  for (const b of bytes) { if (b === 0) r = "1" + r; else break; }
  return r;
}

function borshStr(s: string): Uint8Array {
  const e = new TextEncoder().encode(s);
  const b = new Uint8Array(4 + e.length);
  b[0] = e.length & 0xff; b[1] = (e.length >> 8) & 0xff; b[2] = (e.length >> 16) & 0xff; b[3] = (e.length >> 24) & 0xff;
  b.set(e, 4);
  return b;
}

function concat(...bufs: Uint8Array[]): Uint8Array {
  const total = bufs.reduce((s, b) => s + b.length, 0);
  const r = new Uint8Array(total);
  let o = 0;
  for (const b of bufs) { r.set(b, o); o += b.length; }
  return r;
}

function serializeAction(method: string, args: Record<string, unknown>): Uint8Array {
  const argsBytes = borshStr(JSON.stringify(args));
  return concat(new Uint8Array([0x01, 0x00]), borshStr(method), argsBytes);
}

function u64(n: number): Uint8Array {
  const b = new Uint8Array(8);
  for (let i = 0; i < 8; i++) b[i] = (n >> (8 * i)) & 0xff;
  return b;
}

function u128(n: bigint): Uint8Array {
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Number((n >> BigInt(8 * i)) & 0xffn);
  return b;
}

function serializeTransaction(tx: {
  signerId: string; publicKey: Uint8Array; nonce: bigint;
  receiverId: string; actions: { type: string; methodName: string; args: string; gas: bigint; deposit: bigint }[];
  blockHash: Uint8Array;
}): Uint8Array {
  const actionBytes = tx.actions.map(a => concat(
    new Uint8Array([0x01, 0x00]), borshStr(a.methodName), borshStr(a.args), u128(a.gas), u128(a.deposit),
  ));
  const actionLen = new Uint8Array(4);
  actionLen[0] = actionBytes.length & 0xff;
  actionLen[1] = (actionBytes.length >> 8) & 0xff;
  return concat(
    borshStr(tx.signerId), tx.publicKey, u64(Number(tx.nonce)), borshStr(tx.receiverId),
    actionLen, ...actionBytes, tx.blockHash,
  );
}

function serializeSignedTx(sig: Uint8Array, tx: Uint8Array): Uint8Array {
  const sigLen = new Uint8Array(4);
  sigLen[0] = 64;
  return concat(sigLen, sig, tx);
}

async function rpc(env: Env, method: string, params: unknown): Promise<any> {
  const res = await fetch(env.NEAR_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
}

// ── Main watcher ────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Poll all relays
    if (url.pathname === "/poll") {
      // ... relay polling logic (same pattern as nostr-gov watcher)
      return new Response("ok");
    }

    // Submit a signed event directly (ingest endpoint)
    if (url.pathname === "/ingest" && request.method === "POST") {
      const event: NostrEvent = await request.json();
      // Verify event ID
      const expectedId = await sha256Hex(nip01Serialize(event));
      if (event.id !== expectedId) {
        return new Response(JSON.stringify({ error: "invalid event id" }), { status: 400 });
      }
      const contractIds = (env.TREASURY_CONTRACT_IDS || "").split(",").map(s => s.trim());
      const contractTag = event.tags.find(t => t[0] === "contract")?.[1];
      if (!contractTag || !contractIds.includes(contractTag)) {
        return new Response(JSON.stringify({ error: "contract not watched" }), { status: 400 });
      }
      // Submit to NEAR
      const result = await submitToNear(env, contractTag, "post", { msg: event.content, ...eventAuthFields(event) });
      return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
    }

    return new Response("nostr-sig watcher", { headers: { "Content-Type": "text/plain" } });
  },
};

async function submitToNear(env: Env, contractId: string, method: string, args: Record<string, string>): Promise<{ ok: boolean; txHash?: string; error?: string }> {
  // ... NEAR tx submission (same pattern as nostr-gov watcher)
  return { ok: false, error: "not implemented" };
}