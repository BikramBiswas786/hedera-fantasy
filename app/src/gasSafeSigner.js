import { ethers } from "ethers";

// Gas limit used when the relay cannot estimate. Hedera charges for at least 80% of the limit,
// which is negligible in testnet HBAR.
const FALLBACK_GAS_LIMIT = 1_500_000n;

/**
 * Wraps a signer so a failed gas estimate doesn't block the transaction. Hedera's JSON-RPC
 * relay sometimes rejects eth_estimateGas without revert data ("missing revert data") even
 * for valid calls. On failure we run the call read-only to surface the real revert reason,
 * and if the call succeeds we send it with a fixed gas limit.
 */
export class GasSafeSigner extends ethers.AbstractSigner {
  constructor(inner, readProvider) {
    super(inner.provider);
    this.inner = inner;
    this.readProvider = readProvider;
  }

  connect() {
    throw new Error("GasSafeSigner cannot be reconnected");
  }

  getAddress() {
    return this.inner.getAddress();
  }

  signTransaction(tx) {
    return this.inner.signTransaction(tx);
  }

  signMessage(message) {
    return this.inner.signMessage(message);
  }

  signTypedData(domain, types, value) {
    return this.inner.signTypedData(domain, types, value);
  }

  async sendTransaction(tx) {
    const req = { ...tx, from: await this.getAddress() };
    if (req.gasLimit == null) {
      try {
        req.gasLimit = ((await this.readProvider.estimateGas(req)) * 12n) / 10n;
      } catch {
        await this.readProvider.call(req); // throws with the revert reason if the call would fail
        req.gasLimit = FALLBACK_GAS_LIMIT;
      }
    }
    return this.inner.sendTransaction(req);
  }
}
