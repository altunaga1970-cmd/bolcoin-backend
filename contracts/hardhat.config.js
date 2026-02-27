require("@nomicfoundation/hardhat-toolbox");
try { require("dotenv/config"); } catch (_) { }

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  paths: {
    sources: "./contracts",
    artifacts: "./artifacts-v2",
    tests: "./test",
    cache: "./cache",
  },
  networks: {
    hardhat: {},
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    amoy: {
      url: process.env.AMOY_RPC_URL || "https://rpc-amoy.polygon.technology",
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
    polygon: {
      url: process.env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com",
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
  },
  etherscan: {
    apiKey: {
      polygon: process.env.POLYGONSCAN_KEY || "",
      polygonAmoy: process.env.POLYGONSCAN_KEY || "",
    },
  },
};
