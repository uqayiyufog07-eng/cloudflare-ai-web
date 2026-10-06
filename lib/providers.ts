import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { extractReasoningMiddleware, wrapLanguageModel } from "ai";
import { createAiGateway } from "ai-gateway-provider";
import { createWorkersAI } from "workers-ai-provider";
import { createWorkersAIFetch } from "@/lib/workers-ai-fetch";
import type { Model } from "@/lib/models";
import { DEFAULT_BASE_URLS } from "@/lib/provider-models";
import { getProviderSettings, type ProviderSettings } from "@/lib/provider-settings";

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

const getGoogleDirectProvider = (settings: ProviderSettings) =>
  createGoogleGenerativeAI({
    apiKey: settings.apiKey,
    ...(settings.baseUrl ? { baseURL: settings.baseUrl } : {}),
  });

type GoogleSearchTool = ReturnType<
  ReturnType<typeof createGoogleGenerativeAI>["tools"]["googleSearch"]
>;

export interface ChatModel {
  model: LanguageModelV4;
  tools?: { google_search: GoogleSearchTool };
}

/**
 * Resolves a catalog model to the language model that serves it.
 * OpenAI-compatible models always come from the admin-configured settings on
 * the /admin Providers page. Google models prefer those settings too and fall
 * back to the AI Gateway environment variables. Throws
 * ProviderConfigurationError when the selected provider is not configured.
 */
export const createChatModel = async (
  catalogModel: Model,
  options: { search?: boolean },
): Promise<ChatModel> => {
  switch (catalogModel.provider) {
    case "openai": {
      const settings = await getProviderSettings("openai");
      if (!settings) {
        throw new ProviderConfigurationError(
          "The OpenAI-compatible provider is not configured. Set it up on the /admin Providers page.",
        );
      }

      const openai = createOpenAICompatible({
        name: "openai",
        baseURL: settings.baseUrl ?? DEFAULT_BASE_URLS.openai,
        apiKey: settings.apiKey,
      });
      return { model: openai.chatModel(catalogModel.id) };
    }
    case "google": {
      const settings = await getProviderSettings("google");
      if (settings) {
        const google = getGoogleDirectProvider(settings);
        return {
          model: google.chat(catalogModel.id),
          tools: options.search ? { google_search: google.tools.googleSearch({}) } : undefined,
        };
      }

      const { gateway, google } = getGoogleGatewayProviders();
      return {
        model: gateway([google.chat(catalogModel.id)]),
        tools: options.search ? { google_search: google.tools.googleSearch({}) } : undefined,
      };
    }
    case "workers-ai": {
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
  }
};
