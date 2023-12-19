import { createInterface } from "readline";
import type { Arguments } from "yargs";
import type { Wallet } from "ethers";
import { type helpers as sdkHelpers, Database } from "@tableland/sdk";
import { studioAliases } from "@tableland/studio-client";
import chalk from "chalk";
import { type GlobalOptions } from "../cli.js";
import {
  ERROR_INVALID_PROJECT_ID,
  FileStore,
  helpers,
  logger,
  normalizePrivateKey,
} from "../utils.js";

// TODO: It seems like the sdk should export a single type for the Database config
type SdkConfig = sdkHelpers.Config & Partial<sdkHelpers.AutoWaitConfig>;

export const command = "query";
export const desc =
  "open a shell to run sql statements  against your selected project";

export const handler = async (
  argv: Arguments<GlobalOptions>,
): Promise<void> => {
  try {
    const { store, providerUrl } = argv;

    if (typeof store !== "string" || store.trim() === "") {
      throw new Error("must provide path to session store file");
    }

    const fileStore = new FileStore(store);
    const apiUrl = helpers.getApiUrl({ apiUrl: argv.apiUrl, store: fileStore });
    const api = helpers.getApi(fileStore, apiUrl);
    const projectId = helpers.getProject({ ...argv, store: fileStore });

    if (typeof projectId !== "string" || !helpers.isUUID(projectId)) {
      throw new Error(ERROR_INVALID_PROJECT_ID);
    }

    const environmentId = await helpers.getEnvironmentId(api, projectId);
    const validateQuery = await helpers.getQueryValidator();

    const studioAliasMapper = studioAliases({
      environmentId,
      apiUrl,
    });

    const _interface = createInterface({
      input: process.stdin,
      output: process.stdout,
      completer,
      terminal: true,
      tabSize: 4,
    });

    let statement = "";
    // readline interfaces don't immediately pause "line" events, so we have to
    // build our own mechanism to pause
    let paused = false;
    let captureLine: undefined | ((line: string) => void);

    // the _interface handler promise isn't being used, but that is ok in this case
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    _interface.on("line", async function (line: string | undefined) {
      if (typeof line !== "string") return;
      if (paused) {
        if (typeof captureLine === "function") captureLine(line);
        return;
      }

      line = line.trim();
      if (line === "") {
        if (statement === "") return resetPrompt();
        return setMidPrompt();
      }

      // note: this gives the first index of ";", if there is more than one
      //   semicolon the check below will ensure the user isn't trying to run
      //   multiple statements at the same time.
      const semiColonIndex = line.indexOf(";");

      // if no semicolon exists they are inputting a multi line statement
      // we should change the prompt and save the previous line's text
      if (semiColonIndex < 0) {
        statement += line + " ";
        return setMidPrompt();
      }

      // if a semicolon exists but is not at the end of the statement they are
      // trying to run multiple statments together, which is not allowed
      if (semiColonIndex < line.length - 1) {
        logger.error(
          "statements must end with `;` and you cannot run more than one statement at a time",
        );
        resetPrompt();
        return;
      }

      statement += line;
      // at this point we have a full statement, we should attempt to run it
      try {
        const queryObject = await validateQuery(statement);

        if (queryObject.type === "create") {
          throw new Error(
            "you cannot create studio project tables with the cli",
          );
        }

        if (queryObject.type !== "read" && !argv.privateKey) {
          throw new Error(
            "you did not provide a private key, you can only run read queries",
          );
        }

        const dbOpts: SdkConfig = {
          aliases: studioAliasMapper,
        };
        if (queryObject.type !== "read") {
          // TODO: all sub-queries I can think of work here, but ask others for try and break this.
          const aliasMap = await studioAliasMapper.read();
          const chainId = helpers.getChainIdFromTableName(
            aliasMap[queryObject.tables[0]],
          );
          const tableId = helpers.getTableIdFromTableName(
            aliasMap[queryObject.tables[0]],
          );
          const wallet = await helpers.getWalletWithProvider({
            privateKey: normalizePrivateKey(argv.privateKey),
            chain: chainId,
            providerUrl,
            api,
          });
          // We have to pause the sql interface so we can use the confirm interface
          pause();
          const proceed = await confirmWrite({
            chainId,
            wallet,
            args: [
              // args for contract `mutate` methods
              wallet.address,
              tableId,
              statement,
            ],
          });
          resume();
          if (!proceed) {
            logger.log("aborting write query.");
            return resetPrompt();
          }
          dbOpts.signer = wallet;
        }

        const db = new Database(dbOpts);
        const preparedStatement = db.prepare(statement);
        const result = await preparedStatement.all();

        logger.log(JSON.stringify(result, null, 4));
        resetPrompt();
      } catch (err: any) {
        logger.error(err);
        resetPrompt();
      }
    });

    const resetPrompt = function () {
      statement = "";
      _interface.setPrompt("> ");
      _interface.prompt();
    };

    const setMidPrompt = function () {
      _interface.setPrompt("... ");
      _interface.prompt();
    };

    const pause = function () {
      paused = true;
    };
    const resume = function () {
      paused = false;
    };

    // we have to do some trickery here because we can't have two interfaces open
    // at the same time
    const confirmWrite = async function (info: {
      wallet: Wallet;
      chainId: number;
      args: any[];
    }) {
      const cost = await helpers.estimateCost({
        signer: info.wallet,
        chainId: info.chainId,
        method: "mutate(address,uint256,string)",
        args: info.args,
      });

      process.stdout.write(
        `You are about to use address: ${chalk.yellow(
          info.wallet.address,
        )} to write to a table on chain ${chalk.yellow(info.chainId)}
The estimated cost is ${cost}
Do you want to continue (${chalk.bold("y/n")})? `,
      );

      return await new Promise(function (resolve, reject) {
        captureLine = function (line: string) {
          captureLine = undefined;
          if (line.toLowerCase()[0] !== "y") {
            resolve(false);
          }

          resolve(true);
        };
      });
    };

    resetPrompt();

    // if the user is midway through a statement and they want to reset the
    // prompt, they can hit control + c, but if hit it twice or are at a fresh
    // prompt already we want to kill the process
    _interface.on("SIGINT", function () {
      const currentPrompt = _interface.getPrompt();
      if (currentPrompt === "> ") process.exit();
      resetPrompt();
    });
  } catch (err: any) {
    logger.error(err);
    logger.error("exiting studio query shell");
  }
};

const sqlTerms = ["select", "insert", "from", "order", "values"];
const completer = function (line: string) {
  // TODO: check against all table names in this project and add to common sql terms
  const words = line.split(" ");
  const word = words.pop();
  if (typeof word !== "string") return [[], line];

  const hits = sqlTerms.filter(function (term: string | undefined) {
    if (typeof term !== "string" || term === "") return false;
    return term.indexOf(word) === 0;
  });
  return [
    hits.map((hit: string) => {
      words.push(hit);
      return words.join(" ");
    }),
    line,
  ];
};
