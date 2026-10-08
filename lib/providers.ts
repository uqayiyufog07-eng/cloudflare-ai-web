import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { extractReasoningMiddleware, wrapLanguageModel } from "ai";
import { createAiGateway } from "ai-gateway-provider";
import { createWorkersAI } from "workers-ai-provider";
import { createWorkersAIFetch } from "@/lib/workers-ai-fetch";
import type { Model } from "@/lib/models";
import { DEFAULT_BASE_URLS } from "@/lib/provider-models";
import { getCustomProvider, type CustomProvider } from "@/lib/provider-settings";

export class ProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigurationError";
  }
}

const requireEnvironmentVariable = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new ProviderConfigurationError(`Missing required environment variable: ${name}`);
  }
  return value;
};

export const getCloudflareCredentials = () => ({
  accountId: requireEnvironmentVariable("CF_ACCOUNT_ID"),
  apiKey: requireEnvironmentVariable("CF_WORKERS_AI_TOKEN"),
});

export const getCloudflareGatewayCredentials = () => {
  const gatewayId = process.env.CF_AI_GATEWAY_NAME;
  if (!gatewayId) {
    return undefined;
  }

  return {
    gatewayId,
    gatewayToken: requireEnvironmentVariable("CF_AI_GATEWAY_TOKEN"),
  };
};

export type CloudflareGatewayCredentials = NonNullable<
  ReturnType<typeof getCloudflareGatewayCredentials>
>;

const getWorkersAIProvider = () => {
  const credentials = getCloudflareCredentials();
  const gatewayCredentials = getCloudflareGatewayCredentials();
  if (!gatewayCredentials) {
    return createWorkersAI({ ...credentials, fetch: createWorkersAIFetch() });
  }

  const { gatewayId, gatewayToken } = gatewayCredentials;
  return createWorkersAI({
    ...credentials,
    gateway: { id: gatewayId },
    fetch: createWorkersAIFetch((input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("cf-aig-authorization", `Bearer ${gatewayToken}`);
      return globalThis.fetch(input, { ...init, headers });
    }),
  });
};

const getGoogleGatewayProviders = () => {
  const google = createGoogleGenerativeAI({
    apiKey: requireEnvironmentVariable("GOOGLE_API_KEY"),
  });
  const gateway = createAiGateway({
    accountId: requireEnvironmentVariable("CF_ACCOUNT_ID"),
    gateway: requireEnvironmentVariable("CF_AI_GATEWAY_NAME"),
    apiKey: requireEnvironmentVariable("CF_AI_GATEWAY_TOKEN"),
  });

  return { gateway, google };
};

const getGoogleDirectProvider = (apiKey: string, baseUrl?: string) =>
  createGoogleGenerativeAI({
    apiKey,
    ...(baseUrl ? { baseURL: baseUrl } : {}),
  });

type GoogleSearchTool = ReturnType<
  ReturnType<typeof createGoogleGenerativeAI>["tools"]["googleSearch"]
>;

export interface ChatModel {
  model: LanguageModelV4;
  tools?: { google_search: GoogleSearchTool };
}

const createCustomProviderChatModel = (
  provider: CustomProvider,
  catalogModel: Model,
): ChatModel => {
  if (provider.style === "gemini") {
    const google = getGoogleDirectProvider(
      provider.apiKey,
      provider.baseUrl ?? DEFAULT_BASE_URLS.gemini,
    );
    return { model: google.chat(catalogModel.id) };
  }

  const openai = createOpenAICompatible({
    name: provider.id,
    baseURL: provider.baseUrl ?? DEFAULT_BASE_URLS.openai,
    apiKey: provider.apiKey,
  });
  return { model: openai.chatModel(catalogModel.id) };
};

/**
 * Resolves a catalog model to the language model that serves it.
 * Custom providers configured on the /admin 模型服务 page are served with
 * their stored OpenAI/Gemini integration style. The legacy "google" model id
 * still falls back to the AI Gateway environment variables. Throws
 * ProviderConfigurationError when the selected provider is not configured.
 */
export const createChatModel = async (
  catalogModel: Model,
  options: { search?: boolean },
): Promise<ChatModel> => {
  if (catalogModel.provider === "workers-ai") {
    const workerModel = getWorkersAIProvider().chat(catalogModel.id);
    return {
      model: catalogModel.reasoning
        ? wrapLanguageModel({
            model: workerModel,
            middleware: extractReasoningMiddleware({ tagName: "think" }),
          })
        : workerModel,
    };
  }

  const configured = await getCustomProvider(catalogModel.provider);
  if (configured) {
    if (!configured.enabled) {
      throw new ProviderConfigurationError(
        `The "${configured.name}" provider is disabled. Enable it on the /admin 模型服务 page.`,
      );
    }
    const chat = createCustomProviderChatModel(configured, catalogModel);
    if (configured.style === "gemini" && options.search) {
      const google = getGoogleDirectProvider(
        configured.apiKey,
        configured.baseUrl ?? DEFAULT_BASE_URLS.gemini,
      );
      return { ...chat, tools: { google_search: google.tools.googleSearch({}) } };
    }
    return chat;
  }

  // Legacy environment-driven path (Google models via the AI Gateway).
  if (catalogModel.provider === "google") {
    const { gateway, google } = getGoogleGatewayProviders();
    return {
      model: gateway([google.chat(catalogModel.id)]),
      tools: options.search ? { google_search: google.tools.googleSearch({}) } : undefined,
    };
  }

  throw new ProviderConfigurationError(
    "The selected provider is not configured. Add it on the /admin 模型服务 page.",
  );
};
