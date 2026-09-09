import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";

export const sha256Bytes = (msg: string): Uint8Array =>
  sha256(new TextEncoder().encode(msg));

export const schnorrSign = (message: string, secretKey: Uint8Array): string => {
  const msgHash = sha256Bytes(message);
  const sig = schnorr.sign(msgHash, secretKey);
  return Array.from(sig).map(b => b.toString(16).padStart(2, "0")).join("");
};

export const defaultExpiryNs = (): string =>
  String(BigInt(Math.floor(Date.now() / 1000) + 7200) * BigInt(1000000000));

export const buildEvent = (params: {
  action: string;
  nonce: number;
  expiresAt: string;
  contractId: string;
  content?: string;
}): NostrEventTemplate => ({
  kind: 37500,
  content: params.content ?? "nostr-sig owner action",
  tags: [
    ["t", "nostr-sig"],
    ["action", params.action],
    ["nonce", String(params.nonce)],
    ["expires", params.expiresAt],
    ["contract", params.contractId],
  ],
  created_at: Math.floor(Date.now() / 1000),
});

export const extractEventFields = (event: SignedNostrEvent) => ({
  pubkey_hex: event.pubkey,
  event_id_hex: event.id,
  created_at: event.created_at,
  kind: event.kind,
  tags_json: JSON.stringify(event.tags),
  content: event.content,
  sig_hex: event.sig,
});

export const eventAuthArgs = (f: ReturnType<typeof extractEventFields>): Record<string, string> => ({
  pk: f.pubkey_hex,
  ev: f.event_id_hex,
  sig: f.sig_hex,
  kind: String(f.kind),
  tags: f.tags_json,
  ct: f.content,
  cat: String(f.created_at),
});

export interface NostrEventTemplate {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
}

export interface SignedNostrEvent extends NostrEventTemplate {
  id: string;
  pubkey: string;
  sig: string;
}