import path from "path";
import { fileURLToPath } from "url";
import { getAccounts } from "@tableland/local";
import { Database } from "@tableland/sdk";
import { getDefaultProvider } from "ethers";
import { afterEach, before, describe, test } from "mocha";
import { equal, match } from "node:assert";
import { restore, spy } from "sinon";
import yargs from "yargs/yargs";
import { type GlobalOptions } from "../src/cli.js";
import * as mod from "../src/commands/project.js";
import { logger, wait } from "../src/utils.js";
import { TEST_TIMEOUT_FACTOR, TEST_API_BASE_URL } from "./setup";


const _dirname = path.dirname(fileURLToPath(import.meta.url));
const accounts = getAccounts();

const TEST_TEAM_ID = "01a2d24d-3805-4a14-8059-7041f8b69afc";
const defaultArgs = [
  "--store",
  path.join(_dirname, ".studioclisession.json"),
  "--privateKey",
  accounts[10].privateKey.slice(2),
  "--chain",
  "local-tableland",
  "--providerUrl",
  "http://127.0.0.1:8545/",
  "--apiUrl",
  TEST_API_BASE_URL
];

// TODO: remove this.  just using it to debug
// const wallet = accounts[10];
// const provider = getDefaultProvider(process.env.PROVIDER_URL);
// const signer = wallet.connect(provider);
// const db = new Database({ signer, autoWait: true });


describe("commands/project", function () {
  this.timeout(30000 * TEST_TIMEOUT_FACTOR);

  before(async function () {
    await wait(1000);
  });

  afterEach(function () {
    restore();
  });

  // TODO: need to fix the fact that all the tests rely on the previous tests.
  const description = "testing project create";
  const projectName = "projectfoo";

  // happy first
  test("can create a project", async function () {
    const consoleLog = spy(logger, "log");

    await yargs([
      "project",
      "create",
      projectName,
      "--description",
      description,
      "--teamId",
      TEST_TEAM_ID,
      ...defaultArgs
    ]).command(mod).parse();

    const res = consoleLog.getCall(0).firstArg;
    const value = JSON.parse(res);

    // assert id format
    const idParts = value.id.split("-");
    equal(idParts.length, 5);
    equal(idParts[0].length, 8);
    equal(idParts[1].length, 4);
    equal(idParts[2].length, 4);
    equal(idParts[3].length, 4);
    equal(idParts[4].length, 12);

    equal(value.name, projectName);
    equal(value.description, description);
    equal(value.slug, projectName);

  });

  test("can list projects", async function () {
    const consoleTable = spy(logger, "table");
    await yargs(["project", "ls", TEST_TEAM_ID, ...defaultArgs]).command(mod).parse();

    const table = consoleTable.getCall(0).firstArg;

    equal(table.length, 1);
    const project = table[0];
    const idParts = project.id.split("-");
    equal(idParts.length, 5);
    equal(idParts[0].length, 8);
    equal(idParts[1].length, 4);
    equal(idParts[2].length, 4);
    equal(idParts[3].length, 4);
    equal(idParts[4].length, 12);

    equal(project.name, projectName);
    equal(project.description, description);
    equal(project.slug, projectName);
  });
});