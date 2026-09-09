/// <reference path="../../../ts/lisp-rlm.d.ts" />
// nostr-sig — minimal Nostr event auth on NEAR
// One admin key. One action: write a message (verified by schnorr sig).
//
// How it works:
// 1. Signer creates a kind-37500 Nostr event with action tags
// 2. The event is submitted to the contract (via wallet or watcher)
// 3. The contract rebuilds NIP-01 serialization: [0,"pk",ts,kind,tags,"content"]
// 4. SHA-256 hash → schnorr verify against the pubkey
// 5. If valid → action authorized
//
// Key rule: content must not contain " or \ — naive concat must match JSON.stringify.

const VERSION = "1";

function die(m: string) {
  near.log(m);
  near.abort(m);
}
function getStr(k: string): string { return near.storageGet(k) ?? ""; }
function numStr(k: string): string { const v = getStr(k); return strLength(v) === 0 ? "0" : v; }

// ── tag parsing (flat JSON array) ──────────────────────────────────────

function unquote(): string { return strSlice(near.jsonQuote(""), 0, 1); }

function tagGet(tags: string, key: string): string {
  const nd = `"` + key + `","`;
  const i = strIndexOf(tags, nd);
  if (i === -1) { return ""; }
  const rest = strSlice(tags, i + strLength(nd), strLength(tags));
  if (strLength(rest) === 0) { return ""; }
  return strSlice(rest, 0, strIndexOf(rest, unquote()));
}

// ── NIP-01 serialization (must match JSON.stringify byte-for-byte) ──

function eventSerialize(pk: string, cat: string, kind: string, tags: string, ct: string): string {
  return `[0,"${pk}",${cat},${kind},${tags},"${ct}"]`;
}

// ── verify kind-37500 event signed by admin ──────────────────────────

function verifyOwnerEvent(actionStr: string): void {
  const pk = near.jsonGetStr("pk") ?? "";
  const kind = near.jsonGetStr("kind") ?? "";
  const tags = near.jsonGetStr("tags") ?? "";
  const ct = near.jsonGetStr("ct") ?? "";
  const sig = near.jsonGetStr("sig") ?? "";
  const cat = near.jsonGetStr("cat") ?? "";
  if (strLength(pk) !== 64) { die("ERR_EVENT_PK_LEN"); }
  if (strLength(sig) !== 128) { die("ERR_EVENT_SIG_LEN"); }
  if (kind !== "37500") { die("ERR_EVENT_KIND"); }
  if (pk !== getStr("pk0")) { die("ERR_EVENT_PK_MISMATCH"); }
  const ta = tagGet(tags, "action");
  const tn = tagGet(tags, "nonce");
  const te = tagGet(tags, "expires");
  const tc = tagGet(tags, "contract");
  const ts = near.blockTimestamp();
  if (u128.gt(ts, te)) { die("ERR_SIG_EXPIRED"); }
  if (ta !== actionStr) { die("ERR_EVENT_ACTION"); }
  if (tc !== near.currentAccountId()) { die("ERR_EVENT_CONTRACT"); }
  const serialized = eventSerialize(pk, cat, kind, tags, ct);
  const ok = schnorrVerify(hexDecode(pk), hexDecode(sig), hexDecode(sha256Hash(serialized)));
  if (ok !== 1) { die("ERR_EVENT_SIG_INVALID"); }
  // simple nonce replay protection
  const nonceKey = "nonce:" + tn;
  if (strLength(getStr(nonceKey)) > 0) { die("ERR_NONCE_USED"); }
  near.storageSet(nonceKey, "1");
}

// ── contract methods ──────────────────────────────────────────────────

export function init(): number {
  if (strLength(getStr("pk0")) !== 0) { die("ERR_ALREADY_INITIALIZED"); }
  const npub = near.jsonGetStr("npub") ?? "";
  if (strLength(npub) !== 64) { die("ERR_BAD_NPUB"); }
  near.storageSet("pk0", npub);
  return 0;
}

export function post(): number {
  if (strLength(near.jsonGetStr("ev") ?? "") === 0) { die("ERR_EV_REQUIRED"); }
  verifyOwnerEvent("post");
  const msg = near.jsonGetStr("msg") ?? "";
  if (strLength(msg) === 0) { die("ERR_MSG_EMPTY"); }
  const cnt = strToNum(numStr("cnt")) + 1;
  near.storageSet("cnt", toStr(cnt));
  near.storageSet("m:" + toStr(cnt), msg);
  return 0;
}

export function get_count(): string { return numStr("cnt"); }
export function get_message(): string { return getStr("m:" + (near.jsonGetStr("id") ?? "")); }
export function get_version(): string { return VERSION; }