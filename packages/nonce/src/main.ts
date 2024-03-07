import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { Redis } from "@upstash/redis";

dotenv.config();

// from ethers.js experimental NonceManager implementation
// TODO: Keep a per-NonceManager pool of sent but unmined transactions for
//    rebroadcasting, in case we overrun the transaction pool

if (
  typeof process.env.KV_REST_API_URL !== "string" ||
  typeof process.env.KV_REST_API_TOKEN !== "string"
) {
  throw new Error("Vercel KV api env variables are not available");
}

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// The logic we need to implement here should follow the ethers.js
// implementation logic, but the delta from on chain nonce

export class NonceManager extends ethers.Signer {
  readonly signer: ethers.Signer;
  readonly provider: ethers.providers.Provider;

  // This redis instance is a singleton in the scope of all NonceManager
  // instances in this process, i.e. each process gets a single redis client.
  readonly memStore = redis;

  _lock: string | undefined;
  _initialPromise: Promise<number> | null;

  constructor(signer: ethers.Signer) {
    super();
    if (typeof signer.provider === "undefined") {
      throw new Error("NonceManager requires a provider at instantiation");
    }

    this._initialPromise = null;
    this.signer = signer;
    this.provider = signer.provider;
  }

  connect(provider: ethers.providers.Provider): ethers.Signer {
    throw new Error("changing providers in not supported");
  }

  async getAddress(): Promise<string> {
    return await this.signer.getAddress();
  }

  async getTransactionCount(
    blockTag?: ethers.providers.BlockTag,
  ): Promise<number> {
    if (blockTag === "pending") {
      if (!this._initialPromise) {
        this._initialPromise = this.signer.getTransactionCount("pending");
      }

      await this._acquireLock();
      // this returns null if the key doesn't exist
      const deltaCount = await this.memStore.get(
        `delta:${await this.getAddress()}`,
      );
      await this._releaseLock();

      // TODO: this `_initialPromise` may no longer serve any purpose. It's
      //     here because that is how ethers implements NonceManager.
      const initial = await this._initialPromise;
      return initial + (typeof deltaCount === "number" ? deltaCount : 0);
    }

    return await this.signer.getTransactionCount(blockTag);
  }

  async setTransactionCount(
    transactionCount: ethers.BigNumberish | Promise<ethers.BigNumberish>,
  ): Promise<void> {
    this._initialPromise = Promise.resolve(transactionCount).then((nonce) => {
      return ethers.BigNumber.from(nonce).toNumber();
    });

    // aquire the lock that protects all nonce managers using the same redis db
    await this._acquireLock();
    await this.memStore.set(`delta:${await this.getAddress()}`, 0);
    await this._releaseLock();
  }

  async incrementTransactionCount(count?: number): Promise<number> {
    return await this.memStore.incrby(
      `delta:${await this.getAddress()}`,
      count == null ? 1 : count,
    );
  }

  async signMessage(message: ethers.Bytes | string): Promise<string> {
    return await this.signer.signMessage(message);
  }

  async signTransaction(
    transaction: ethers.utils.Deferrable<ethers.providers.TransactionRequest>,
  ): Promise<string> {
    return await this.signer.signTransaction(transaction);
  }

  async sendTransaction(
    transaction: ethers.utils.Deferrable<ethers.providers.TransactionRequest>,
  ): Promise<ethers.providers.TransactionResponse> {
    if (transaction.nonce instanceof Promise) {
      transaction.nonce = await transaction.nonce;
    }

    if (transaction.nonce == null) {
      transaction = ethers.utils.shallowCopy(transaction);
      transaction.nonce = await this.getTransactionCount("pending");
      await this.incrementTransactionCount();
    } else {
      await this.setTransactionCount(transaction.nonce);
      await this.memStore.incr(`delta:${await this.getAddress()}`);
    }

    const tx = await this.signer.sendTransaction(transaction);
    return tx;
  }

  // There is one lock per public key.  The "key" is the public key, and the
  // value is something only a single nonce manager instance knows.  This
  // ensures that only the nonce manager that aquired the lock will release the
  // lock.
  async _setLock() {
    if (!this._lock) {
      throw new Error("must have a value to set lock");
    }
    return await this.memStore.set(
      `lock:${await this.getAddress()}`,
      this._lock,
      // `nx` specifies we will only set if the key does NOT exist
      // `px` specifies the key expires after a given number of milliseconds
      { nx: true, px: 3000 },
    );
  }

  async _acquireLock() {
    // make sure we don't try to aquire multiple times
    if (this._lock) {
      throw new Error("cannot aquire a lock simultaneously in one instance");
    }
    this._lock = Math.random().toString();

    // If the lock was not acquired, we want to retry using increasing backoff
    // combined with "jitter".  For a nice overview of the reasoning here, read
    // https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter

    const acquire = this._setLock.bind(this);
    const backoffRate = 50; // ms
    const maxWait = 2000; // ms
    let trys = 0;
    const doTry = async function () {
      trys += 1;
      await new Promise(function (resolve, reject) {
        const wait = Math.random() * Math.min(maxWait, trys * backoffRate);

        // `setTimeout`'s function should return void so we don't swallow a
        // Promise, hence using `catch` instead of `await`ing.
        setTimeout(function () {
          // capture resolve & reject in scope
          (async function () {
            // returns null or "OK"
            const res = await acquire();

            if (res === null) {
              return resolve(await doTry());
            }

            resolve(res);
          })().catch((err) => reject(err));
        }, wait);
      });
    };

    await doTry();
  }

  async _releaseLock() {
    if (!this._lock) return;

    // we are using a Lua script to atomically make sure we only delete the
    // lock if this process created it. This covers the case where the lock ttl
    // expires before the lock is released. Without out this check, this
    // process might release a lock it did not acquire.
    await this.memStore.eval(
      `if redis.call("get",KEYS[1]) == ARGV[1] then
          return redis.call("del",KEYS[1])
      else
          return 0
      end`,
      [`lock:${await this.getAddress()}`],
      [this._lock],
    );
    this._lock = undefined;
  }
}