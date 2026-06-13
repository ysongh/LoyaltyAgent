import type { HardhatUserConfig } from "hardhat/config";
import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import "dotenv/config";

const { ARC_TESTNET_RPC_URL, RELAYER_PRIVATE_KEY } = process.env;

const config: HardhatUserConfig = {
  plugins: [hardhatToolboxViem],
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    arcTestnet: {
      type: "http",
      url: ARC_TESTNET_RPC_URL ?? "https://rpc.testnet.arc.network",
      chainId: 5042002,
      // Arc uses USDC as its native gas token, so the deployer pays gas in USDC, not ETH.
      // The account below is funded with testnet USDC from https://faucet.circle.com.
      accounts: RELAYER_PRIVATE_KEY ? [RELAYER_PRIVATE_KEY] : [],
    },
  },
};

export default config;
