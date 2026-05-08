import { Database } from "../types/database";
import { SupabaseClient } from "@supabase/supabase-js";
import { Super } from "./supabase";
import { Context } from "../../../types/context";

export class Wallet extends Super {
  constructor(supabase: SupabaseClient<Database>, context: Context) {
    super(supabase, context);
  }

  /**
   * Retrieves the wallet address associated with a given GitHub user ID.
   *
   * @param userId - The GitHub numerical user ID.
   * @returns A Promise that resolves to the wallet address string.
   * @throws Error if the query fails.
   */
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

  /**
   * Retrieves the wallet address associated with a given GitHub username.
   *
   * @param username - The GitHub username.
   * @returns A Promise that resolves to the wallet address string, or null if not found.
   */
  async getAddressByUsername(username: string): Promise<string | null> {
    const { data, error } = await this.supabase.from("users").select("wallets(address)").eq("username", username).single();
    if (error) {
      console.error("Failed to get wallet address by username", { username, error });
      return null;
    }

    return (data.wallets as unknown as { address: string })?.address || null;
  }

  /**
   * Updates or inserts a wallet address for a user.
   *
   * @param userId - The GitHub numerical user ID.
   * @param address - The wallet address to associate with the user.
   * @returns A Promise that resolves when the operation is complete.
   * @throws Error if the wallet or user update fails.
   */
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
