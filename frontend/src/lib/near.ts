import { Account, Near, KeyPair, JsonProvider } from "near-api-js";
import { schnorrSign, defaultExpiryNs, buildEvent, extractEventFields, eventAuthArgs } from "./schnorr";
import { finalizeEvent } from "nostr-tools";

const NETWORK_ID = "testnet";
const NODE_URL = "https://rpc.testnet.fastnear.com";

let near: Near;
let keyStore: any;

async function getNear() {
  if (near) return near;
  // browser wallet
  const wallet = (window as any).walletSelector;
  if (wallet) return null; // using wallet selector
  keyStore = new (await import("near-api-js")).keyStores.InMemoryKeyStore();
  near = new Near({ networkId: NETWORK_ID, nodeUrl: NODE_URL, keyStore });
  return near;
}

export async function getOwnerNonce(contractId: string): Promise<number> {
  const provider = new JsonProvider(NODE_URL);
  const res = await provider.query({
    request_type: "call_function",
    account_id: contractId,
    method_name: "get_owner_nonce",
    args_base64: btoa("{}"),
    finality: "optimistic",
  });
  return Number((res as any).result.map((b: number) => String.fromCharCode(b)).join(""));
}

export async function postMessage(
  contractId: string,
  message: string,
  secretKey: Uint8Array,
) {
  const nonce = await getOwnerNonce(contractId);
  const action = "post";
  const expiresAt = defaultExpiryNs();
  const template = buildEvent({ action, nonce, expiresAt, contractId });
  const signed = finalizeEvent(template, secretKey);
  const f = extractEventFields(signed);
  const args = { msg: message, ...eventAuthArgs(f) };
  // In a real app, submit via wallet. For testing, return args.
  return args;
}