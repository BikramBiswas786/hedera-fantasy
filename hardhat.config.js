require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { HEDERA_PRIVATE_KEY } = process.env;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: "cancun" },
  },
  networks: {
    // enough test accounts to fill a maximum-size (300-entry) contest with different players
    hardhat: { accounts: { count: 310 } },
    hederaTestnet: {
      url: process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api",
      chainId: 296,
      accounts: HEDERA_PRIVATE_KEY ? [HEDERA_PRIVATE_KEY] : [],
    },
  },
};

// Use the solc npm package (solcjs) when binaries.soliditylang.org is unreachable.
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (process.env.USE_SOLCJS !== "1") return runSuper();
  const solcPath = require.resolve("solc/soljson.js");
  return { compilerPath: solcPath, isSolcJs: true, version: args.solcVersion, longVersion: require("solc").version() };
});
