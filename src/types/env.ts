import { Type as T } from "@sinclair/typebox";
import { StaticDecode } from "@sinclair/typebox";

export const envSchema = T.Object({
  GITHUB_TOKEN: T.String(),
  SUPABASE_URL: T.String(),
  SUPABASE_KEY: T.String(),
  X25519_PRIVATE_KEY: T.String(),
  NFT_MINTER_PRIVATE_KEY: T.Optional(T.String()),
  NFT_CONTRACT_ADDRESS: T.Optional(T.String()),
});

export type Env = StaticDecode<typeof envSchema>;
