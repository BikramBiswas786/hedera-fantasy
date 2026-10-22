// Read data published to Hedera Consensus Service through the public mirror node.
// Refs look like "hcs:<topicId>:<sequenceNumber>" (sequence number of the first chunk).
// Used by the verifier script and the web app; works in Node 18+ and browsers.

export const MIRROR_NODES = {
  testnet: "https://testnet.mirrornode.hedera.com",
  mainnet: "https://mainnet.mirrornode.hedera.com",
};

export function parseHcsRef(ref) {
  const m = /^hcs:(\d+\.\d+\.\d+):(\d+)$/.exec(ref || "");
  return m ? { topicId: m[1], sequence: Number(m[2]) } : null;
}

const b64decode = (s) =>
  typeof atob === "function" ? Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) : new Uint8Array(Buffer.from(s, "base64"));

/** Fetch a (possibly chunked) HCS message and return its text. */
export async function fetchHcsMessage(ref, mirror = MIRROR_NODES.testnet) {
  const parsed = parseHcsRef(ref);
  if (!parsed) throw new Error(`not an HCS ref: ${ref}`);
  const { topicId, sequence } = parsed;
  const get = async (seq) => {
    const res = await fetch(`${mirror}/api/v1/topics/${topicId}/messages/${seq}`);
    if (!res.ok) throw new Error(`mirror node ${res.status} for ${topicId}#${seq}`);
    return res.json();
  };

  const first = await get(sequence);
  const total = first.chunk_info?.total || 1;
  const initialTx = JSON.stringify(first.chunk_info?.initial_transaction_id || null);
  const chunks = [first];
  // chunks of one message are submitted back to back, but other messages can interleave
  for (let seq = sequence + 1; chunks.length < total && seq < sequence + total * 20; seq++) {
    const msg = await get(seq);
    if (JSON.stringify(msg.chunk_info?.initial_transaction_id || null) === initialTx) chunks.push(msg);
  }
  if (chunks.length < total) throw new Error(`missing chunks for ${ref}`);
  chunks.sort((a, b) => a.chunk_info.number - b.chunk_info.number);

  const bytes = chunks.map((c) => b64decode(c.message));
  const all = new Uint8Array(bytes.reduce((n, b) => n + b.length, 0));
  let off = 0;
  for (const b of bytes) {
    all.set(b, off);
    off += b.length;
  }
  return new TextDecoder().decode(all);
}
