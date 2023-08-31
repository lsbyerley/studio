import { helpers } from "@tableland/sdk";
import { Wallet, getDefaultProvider, providers } from "ethers";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface FileStoreOptions {
  storePath: string;
}

export class FileStorage {
  readonly storePath: string;
  readonly options: FileStoreOptions;

  constructor(options: FileStoreOptions) {
    if (!options.storePath) {
      throw new Error("you must provide path to the file store");
    }

    this.storePath = options.storePath;
    this.options = options;
  }

  getInstance(storageKey: string) {
    const storeFilePath = join(this.storePath, storageKey + ".json");
    try {
      const fileBuf = readFileSync(storeFilePath);
      const fullStorage = JSON.parse(fileBuf.toString());
      return new StoreInstance(fullStorage);
    } catch (err: any) {
      // TODO: figure out when to throw
      if (err.message !== "ENOENT") throw err;
    }

    writeFileSync(storeFilePath, "{}");
    return new StoreInstance({});
  }
}

export class StoreInstance {
  readonly data: Record<string, any>;

  constructor(data: Record<string, any>) {
    this.data = data;
  }

  get<T>(key: string): T {
    return this.data[key];
  }

  set(key: string, val: any) {
    this.data[key] = val;
  }
}

export function constructURL(params: {
  baseURL: string;
  query?: Record<string, unknown>;
  hash?: Record<string, unknown>;
}): string {
  const { baseURL, query, hash } = params;

  const url = new URL(baseURL);
  if (query) {
    Object.keys(query).forEach((key) => {
      url.searchParams.append(key, query[key] as string);
    });
  }
  if (hash) {
    const h = new URL(
      constructURL({ baseURL, query: hash }),
    ).searchParams.toString();
    url.hash = h;
  }
  return url.toString();
}

export function normalizePrivateKey(key: unknown): string {
  if (typeof key !== "string") throw new Error("private key must be a string");
  if (key.startsWith("0x")) {
    return key.slice(2);
  }
  return key;
}

// TODO: this is copy/paste from tableland cli
export const getChains = function (): typeof helpers.supportedChains {
  return Object.fromEntries(
    Object.entries(helpers.supportedChains).filter(
      ([name]) => !name.includes("staging"),
    ),
  ) as Record<helpers.ChainName, helpers.ChainInfo>;
};
export function getChainName(
  chain: number | helpers.ChainName,
): helpers.ChainName {
  if (typeof chain === "number") {
    // convert chainId to chain name
    return helpers.getChainInfo(chain)?.chainName;
  }
  return chain;
}

export interface Options {
  privateKey: string;
  chain: number | helpers.ChainName;
  providerUrl: string | undefined;
}

export interface NormalizedStatement {
  tables: string[];
  statements: string[];
  type: string;
}

export const wait = async (timeout: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, timeout));

export function getLink(chain: helpers.ChainName, hash: string): string {
  /* c8 ignore start */
  if (chain.includes("ethereum")) {
    if (chain.includes("goerli")) {
      return `https://goerli.etherscan.io/tx/${hash}`;
    }
    return `https://etherscan.io/tx/${hash}`;
  } else if (chain.includes("polygon")) {
    if (chain.includes("mumbai")) {
      return `https://mumbai.polygonscan.com/tx/${hash}`;
    }
    return `https://polygonscan.com/tx/${hash}`;
  } else if (chain.includes("optimism")) {
    if (chain.includes("goerli")) {
      return `https://blockscout.com/optimism/goerli/tx/${hash}`;
    }
    return `https://optimistic.etherscan.io/tx/${hash}`;
  } else if (chain.includes("arbitrum")) {
    if (chain.includes("goerli")) {
      return `https://goerli-rollup-explorer.arbitrum.io/tx/${hash}`;
    }
    return `https://arbiscan.io/tx/${hash}`;
  }
  return "";
  /* c8 ignore stop */
}

export async function getWalletWithProvider({
  privateKey,
  chain,
  providerUrl,
}: Options): Promise<Wallet> {
  if (privateKey == null) {
    throw new Error("missing required flag (`-k` or `--privateKey`)");
  }
  let network: helpers.ChainInfo;
  try {
    network = helpers.getChainInfo(chain);
  } catch (e) {
    throw new Error("unsupported chain (see `chains` command for details)");
  }

  const wallet = new Wallet(privateKey);

  // We want to aquire a provider using the params given by the caller.
  let provider: providers.BaseProvider | undefined;
  // first we check if a providerUrl was given.
  if (typeof providerUrl === "string") {
    provider = new providers.JsonRpcProvider(providerUrl, network.name);
  }

  // Second we will check if the "local-tableland" chain is being used,
  // because the default provider won't work with this chain.
  if (provider == null && network.chainName === "local-tableland") {
    provider = new providers.JsonRpcProvider("http://127.0.0.1:8545");
  }

  // Finally we use the default provider
  /* c8 ignore start */
  if (provider == null) {
    try {
      // This will be significantly rate limited, but we only need to run it once
      provider = getDefaultProvider({ ...network, name: network.chainName });
    } catch (err: any) {
      // ethers.js only gives away default provider keys for some networks
      throw new Error(
        "no default provider is available for this network, you must provide one via flag (`-p` or `--providerUrl`)",
      );
    }
  }

  if (provider == null) {
    throw new Error("unable to create ETH API provider");
  }

  let providerChainId: number | undefined;
  try {
    providerChainId = (await provider.getNetwork()).chainId;
  } catch (err) {
    throw new Error("cannot determine provider chain ID");
  }

  if (providerChainId !== network.chainId) {
    throw new Error("provider / chain mismatch.");
  }

  /* c8 ignore stop */
  return wallet.connect(provider);
}

// Wrap any direct calls to console.log, so that test spies can distinguise between
// the CLI's output, and messaging that originates outside the CLI
export const logger = {
  log: function (message: string) {
    console.log(message);
  },
  table: function (message: unknown[] | undefined) {
    console.table(message);
  },
  error: function (message: string | unknown) {
    console.error(message);
  },
};