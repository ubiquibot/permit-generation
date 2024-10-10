import { Type as T } from "@sinclair/typebox";
import { StaticDecode } from "@sinclair/typebox";
import "dotenv/config";

export const envSchema = T.Object({
  GITHUB_TOKEN: T.String(),
  SUPABASE_URL: T.String(),
  SUPABASE_KEY: T.String(),
  NFT_MINTER_PRIVATE_KEY: T.String(),
  NFT_CONTRACT_ADDRESS: T.String(),
  EVM_NETWORK_ID: T.Optional(T.String()),
  EVM_PRIVATE_KEY: T.Optional(T.String()),
  EVM_TOKEN_ADDRESS: T.Optional(T.String()),
  USERS_AMOUNTS: T.Optional(T.String()),
});

export type Env = StaticDecode<typeof envSchema>;
