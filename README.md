# nostr-sig

Minimal reference: sign a Nostr event → verify on NEAR → store on-chain.

Three pieces:
- **contract/** — NEAR WASM that verifies BIP-340 schnorr signatures over NIP-01 events
- **frontend/** — Signs events with your Nostr key, submits to NEAR
- **watcher/** — Relays Nostr events to NEAR (gasless path)

## How it works

```
Nostr key signs event ──► NIP-01 serialization ──► SHA-256 ──► BIP-340 sig
                                                                    │
Contract verifies:  eventSerialize(pk,ts,kind,tags,ct) ──► SHA-256 ──► schnorrVerify
```

The contract rebuilds the exact same bytes the signer used, hashes them, and verifies the schnorr signature. If it matches, the action is authorized.

## Key insight

`eventSerialize` must produce identical bytes to NIP-01's `JSON.stringify([0, pk, created_at, kind, tags, content])`. The contract uses naive concatenation, so content must not contain `"` or `\` — pipe-delimited key=value pairs work perfectly.

## Build & test

```bash
cd contract && ./build.sh          # compile to WASM
cd contract/tests && python3 e2e-mock.py  # offline test
```

## Deploy

```bash
cd frontend && npm run build && npx wrangler pages deploy dist --project-name=nostr-sig
cd watcher && npx wrangler deploy
```