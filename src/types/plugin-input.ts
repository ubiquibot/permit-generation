import { EmitterWebhookEvent as WebhookEvent, EmitterWebhookEventName as WebhookEventName } from "@octokit/webhooks";
import { SupportedEvents } from "./context";
import { StaticDecode, Type as T } from "@sinclair/typebox";

export interface PluginInputs<T extends WebhookEventName = SupportedEvents> {
  stateId: string;
  eventName: T;
  eventPayload: WebhookEvent<T>["payload"];
  settings: PermitGenerationSettings;
  authToken: string;
  ref: string;
}

export const permitRequestSchema = T.Object({
  type: T.Union([T.Literal("ERC20"), T.Literal("ERC721")]),
  username: T.String(),
  amount: T.Number(),
  contributionType: T.String(),
  tokenAddress: T.String(),
});

export type PermitRequest = StaticDecode<typeof permitRequestSchema>;

export const permitGenerationSettingsSchema = T.Object({
  evmNetworkId: T.Number(),
  evmPrivateEncrypted: T.String(),
  permitRequests: T.Array(permitRequestSchema),
  runId: T.Optional(T.Number()),
});

export type PermitGenerationSettings = StaticDecode<typeof permitGenerationSettingsSchema>;
