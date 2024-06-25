import { Database } from "../types/database";
import { SupabaseClient } from "@supabase/supabase-js";
import { Super } from "./supabase";
import { Context } from "../../../types/context";

const FAILED_TO_GET_USER = "Failed to get user";
const SUCCESSFULLY_FETCHED_USER = "Successfully fetched user";

export class User extends Super {
  constructor(supabase: SupabaseClient<Database>, context: Context) {
    super(supabase, context);
  }

  async getUserById(userId: number) {
    const { data, error } = await this.supabase.from("users").select("*").eq("id", userId).single();
    if (error) {
      console.error(FAILED_TO_GET_USER, { userId, error });
      throw error;
    }

    console.log(SUCCESSFULLY_FETCHED_USER, { userId, ...data });
    return data;
  }

  async getUserIdByWallet(wallet: string) {
    const { data, error } = await this.supabase.from("wallets").select("id").eq("address", wallet).single();
    if (error) {
      console.error(FAILED_TO_GET_USER, { wallet, error });
      throw error;
    }

    console.log(SUCCESSFULLY_FETCHED_USER, { wallet, userId: data?.id });
    return data?.id.toString();
  }

  async upsertUser(userId: number, username: string) {
    const { error } = await this.supabase.from("users").upsert({ id: userId, username }).select();
    if (error) {
      console.error("Failed to upsert user", { userId, username, error });
      throw error;
    }

    console.log("Successfully upserted user", { userId, username });
  }

  async deleteUser(userId: number) {
    const { error } = await this.supabase.from("users").delete().eq("user_id", userId);
    if (error) {
      console.error("Failed to delete user", { userId, error });
      throw error;
    }

    console.log("Successfully deleted user", { userId });
  }
}

