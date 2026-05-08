import { Database } from "../types/database";
import { SupabaseClient } from "@supabase/supabase-js";
import { Super } from "./supabase";
import { Context } from "../../../types/context";

export class Wallet extends Super {
  constructor(supabase: SupabaseClient<Database>, context: Context) {
    super(supabase, context);
  }

  async getWalletByUserId(userId: number) {
    const { data, error } = await this.supabase.from("users").select("wallets(address)").eq("id", userId).single();
    if (error) {
      console.error("Failed to get wallet", { userId, error });
      throw error;
    }

    const address = (data.wallets as unknown as { address: string })?.address;
    console.info("Successfully fetched wallet", { userId, address });
    return address;
  }

  async getAddressByUsername(username: string): Promise<string | null> {
    const { data, error } = await this.supabase.from("users").select("wallets(address)").eq("username", username).single();
    if (error) {
      console.error("Failed to get wallet address by username", { username, error });
      return null;
    }

    return (data.wallets as unknown as { address: string })?.address || null;
  }

  async upsertWallet(userId: number, address: string) {
    const { error: walletError, data } = await this.supabase.from("wallets").upsert([{ address }]).select().single();

    if (walletError) {
      console.error("Failed to upsert wallet", { userId, address, walletError });
      throw walletError;
    }

    const { error: userError } = await this.supabase.from("users").upsert([{ id: userId, wallet_id: data.id }]);

    if (userError) {
      console.error("Failed to upsert user with new wallet", { userId, address, userError });
      throw userError;
    }

    console.info("Successfully upsert wallet", { userId, address });
  }
}
