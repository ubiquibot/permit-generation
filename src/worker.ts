/**
 * Cloudflare Worker entry point for permit-generation plugin.
 *
 * Endpoints:
 *   GET  /      → health check
 *   POST /      → generate permits (UbiquityOS plugin webhook)
 */
import { Octokit } from "@octokit/rest";
import { Value } from "@sinclair/typebox/value";
import { createClient } from "@supabase/supabase-js";
import { createAdapters } from "./adapters";
import { Database } from "./adapters/supabase/types/database";
import { generatePayoutPermit } from "./handlers";
import { registerWallet } from "./handlers/register-wallet";
import { Context, Logger } from "./types/context";
import { envSchema, Env } from "./types/env";
import { permitGenerationSettingsSchema, PluginInputs } from "./types/plugin-input";

export interface EnvBindings {
  GITHUB_TOKEN: string;
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  X25519_PRIVATE_KEY: string;
  NFT_MINTER_PRIVATE_KEY: string;
  NFT_CONTRACT_ADDRESS: string;
}

function createLogger(): Logger {
  return {
    debug(message: unknown, ...optionalParams: unknown[]) {
      console.debug(message, ...optionalParams);
    },
    info(message: unknown, ...optionalParams: unknown[]) {
      console.log(message, ...optionalParams);
    },
    warn(message: unknown, ...optionalParams: unknown[]) {
      console.warn(message, ...optionalParams);
    },
    error(message: unknown, ...optionalParams: unknown[]) {
      console.error(message, ...optionalParams);
    },
    fatal(message: unknown, ...optionalParams: unknown[]) {
      console.error("[FATAL]", message, ...optionalParams);
    },
  };
}

function validateEnvironment(env: EnvBindings): Env {
  const envObj: Record<string, string | undefined> = {
    GITHUB_TOKEN: env.GITHUB_TOKEN,
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_KEY: env.SUPABASE_KEY,
    NFT_MINTER_PRIVATE_KEY: env.NFT_MINTER_PRIVATE_KEY,
    NFT_CONTRACT_ADDRESS: env.NFT_CONTRACT_ADDRESS,
  };

  // Filter out undefined values so typebox validation works correctly
  const filteredEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(envObj)) {
    if (value !== undefined) {
      filteredEnv[key] = value;
    }
  }

  if (!Value.Check(envSchema, filteredEnv)) {
    const errors = [...Value.Errors(envSchema, filteredEnv)];
    throw new Error(`Environment validation failed: ${errors.map((e) => `${e.path}: ${e.message}`).join(", ")}`);
  }

  return Value.Decode(envSchema, filteredEnv);
}

async function handleWebhook(request: Request, env: EnvBindings): Promise<Response> {
  const logger = createLogger();

  try {
    const validatedEnv = validateEnvironment(env);

    const body = (await request.json()) as PluginInputs;

    // Validate settings if provided directly in the request body settings field
    if (body.settings) {
      if (!Value.Check(permitGenerationSettingsSchema, body.settings)) {
        const errors = [...Value.Errors(permitGenerationSettingsSchema, body.settings)];
        return Response.json({ error: "Invalid settings", details: errors.map((e) => `${e.path}: ${e.message}`) }, { status: 400 });
      }
    }

    const settings = Value.Decode(permitGenerationSettingsSchema, body.settings);
    const authToken = body.authToken || validatedEnv.GITHUB_TOKEN;

    const octokit = new Octokit({ auth: authToken });
    const supabaseClient = createClient<Database>(validatedEnv.SUPABASE_URL, validatedEnv.SUPABASE_KEY);

    const context: Context = {
      eventName: body.eventName,
      payload: body.eventPayload,
      config: settings,
      octokit,
      env: validatedEnv,
      logger,
      adapters: {} as ReturnType<typeof createAdapters>,
    };

    context.adapters = createAdapters(supabaseClient, context);

    if (body.eventName === "issue_comment.created") {
      const result = await handleSlashCommands(context, octokit);
      return Response.json({ success: true, result });
    } else {
      const permits = await generatePayoutPermit(context, settings.permitRequests);
      return Response.json({ success: true, permits });
    }
  } catch (error) {
    logger.error("Worker error", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}

async function handleSlashCommands(context: Context, octokit: Octokit) {
  const payload = context.payload as Context<"issue_comment.created">["payload"];
  const body = payload.comment?.body ?? "";

  const registrationRegex = /\/wallet (0x[a-fA-F0-9]{40})/g;
  const matches = body.match(registrationRegex);

  if (matches) {
    const address = matches[0];
    if (!(await registerWallet(context, address))) {
      await octokit.rest.issues.createComment({
        owner: (payload as { repository: { owner: { login: string } } }).repository.owner.login,
        repo: (payload as { repository: { name: string } } }).repository.name,
        issue_number: (payload as { issue: { number: number } }).issue.number,
        body: `Failed to register wallet: ${address}`,
      });
      return { registered: false, address };
    }
    return { registered: true, address };
  }

  return { action: "no_matching_command" };
}

function handleHealthCheck(): Response {
  return Response.json({
    status: "ok",
    service: "@ubiquity-os/permit-generation",
    version: "2.0.0",
    timestamp: new Date().toISOString(),
  });
}

export default {
  async fetch(request: Request, env: EnvBindings): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    try {
      let response: Response;

      if (request.method === "GET") {
        response = handleHealthCheck();
      } else if (request.method === "POST") {
        response = await handleWebhook(request, env);
      } else {
        response = Response.json({ error: "Method not allowed" }, { status: 405 });
      }

      // Apply CORS headers to all responses
      const newHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders)) {
        newHeaders.set(key, value);
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Internal server error" },
        {
          status: 500,
          headers: corsHeaders,
        }
      );
    }
  },
};
