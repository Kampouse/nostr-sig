import { useState } from "react";

export default function App() {
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-4">
      <h1 className="text-2xl font-bold mb-1">nostr-sig</h1>
      <p className="text-sm text-neutral-400 mb-6">Sign a Nostr event → verify on NEAR → store on-chain</p>

      <div className="w-full max-w-sm space-y-3">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type a message..."
          className="w-full px-3 py-2 rounded bg-neutral-900 border border-neutral-700 text-white text-sm outline-none focus:border-green-400"
        />
        <button
          onClick={() => setStatus("Not connected — use with NEAR wallet")}
          className="w-full px-4 py-2 rounded bg-green-500 text-black font-bold text-sm hover:bg-green-400"
        >
          Post (sign with Nostr key)
        </button>
        {status && <p className="text-xs text-neutral-500">{status}</p>}
      </div>

      <div className="mt-8 text-xs text-neutral-600 max-w-sm text-center">
        <p>How it works:</p>
        <ol className="list-decimal text-left mt-2 space-y-1">
          <li>You sign a kind-37500 Nostr event with your key</li>
          <li>The event is submitted to the NEAR contract</li>
          <li>The contract verifies the BIP-340 schnorr signature</li>
          <li>If valid, your message is stored on-chain</li>
        </ol>
      </div>
    </div>
  );
}