export type ModelType = "Text Generation" | "Text to Image";
export type ModelProvider = "workers-ai" | "google" | "openai";
export type ModelSource = "cloudflare" | "external";
export type ModelInput = "image" | "search";

export interface Model {
  id: string;
  name: string;
  brand: string;
  type: ModelType;
  provider: ModelProvider;
  source: ModelSource;
  input?: ModelInput[];
  reasoning?: boolean;
  tag?: string[];
}

const BRAND_NAMES: Record<string, string> = {
  "black-forest-labs": "Black Forest Labs",
  bytedance: "ByteDance",
  "deepseek-ai": "DeepSeek",
  google: "Google",
  leonardo: "Leonardo",
  lykon: "Lykon",
  meta: "Meta",
  mistralai: "Mistral",
  moonshotai: "Moonshot AI",
  openai: "OpenAI",
  qwen: "Qwen",
  "zai-org": "ZAI",
};

export const externalModels: Model[] = [
  {
    id: "gemini-3.6-flash",
    name: "gemini-3.6-flash",
    brand: "Google",
    type: "Text Generation",
    input: ["image", "search"],
    provider: "google",
    source: "external",
  },
];

export const getModelName = (id: string) => id.split("/").at(-1) ?? id;

export const getModelBrand = (id: string) => {
  const namespace = id.split("/")[1];
  if (!namespace) {
    return "Other";
  }

  return (
    BRAND_NAMES[namespace] ??
    namespace
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
};

export const getModelGroup = (model: Model) =>
  model.source === "external" ? "External" : model.brand;

/**
 * External models can be served by any OpenAI-compatible endpoint, so the
 * stored provider alone cannot identify the actual vendor. Recognize the
 * model family from its id (Claude -> Anthropic, GPT/o-series -> OpenAI,
 * Gemini -> Google, ...) so the UI can show the right brand mark and badge.
 */
type ExternalVendor = {
  brand: string;
  apiLabel: string;
  prefixes: string[];
};

const EXTERNAL_VENDORS: ExternalVendor[] = [
  { brand: "Anthropic", apiLabel: "Anthropic API", prefixes: ["claude"] },
  { brand: "xAI", apiLabel: "xAI API", prefixes: ["grok"] },
  { brand: "Google", apiLabel: "Google API", prefixes: ["gemini"] },
  { brand: "DeepSeek", apiLabel: "DeepSeek API", prefixes: ["deepseek"] },
  { brand: "Qwen", apiLabel: "Qwen API", prefixes: ["qwen", "qwq"] },
  { brand: "ZAI", apiLabel: "Zhipu API", prefixes: ["glm"] },
  { brand: "Moonshot AI", apiLabel: "Moonshot API", prefixes: ["kimi", "moonshot"] },
  {
    brand: "Mistral",
    apiLabel: "Mistral API",
    prefixes: ["mistral", "mixtral", "codestral", "magistral", "mathstral"],
  },
  { brand: "Meta", apiLabel: "Meta API", prefixes: ["llama"] },
  { brand: "ByteDance", apiLabel: "ByteDance API", prefixes: ["doubao"] },
  { brand: "OpenAI", apiLabel: "OpenAI API", prefixes: ["gpt"] },
];

const inferExternalVendor = (model: Model): ExternalVendor | undefined => {
  const id = model.id.toLowerCase();
  const vendor = EXTERNAL_VENDORS.find(({ prefixes }) =>
    prefixes.some((prefix) => id.startsWith(prefix)),
  );
  if (vendor) {
    return vendor;
  }
  // OpenAI o-series reasoning models (o1, o3, ...).
  if (/^o[0-9]/.test(id)) {
    return EXTERNAL_VENDORS.find(({ brand }) => brand === "OpenAI");
  }
  return undefined;
};

/** Brand name used for the model logo; falls back to the model's brand. */
export const getDisplayBrand = (model: Model): string =>
  inferExternalVendor(model)?.brand ?? model.brand;

/** Badge label shown next to external models. */
export const getExternalProviderLabel = (model: Model): string => {
  const vendor = inferExternalVendor(model);
  if (vendor) {
    return vendor.apiLabel;
  }
  return model.provider === "google" ? "Google API" : "OpenAI API";
};

export const getExternalModels = () => {
  const providers = process.env.NEXT_PUBLIC_CF_AI_GATEWAY_PROVIDERS?.split(",")
    .map((provider) => provider.trim())
    .filter(Boolean);

  return externalModels.filter((model) => providers?.includes(model.provider));
};
