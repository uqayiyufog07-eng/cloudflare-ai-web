import { describe, expect, test } from "bun:test";
import { getDisplayBrand, getExternalProviderLabel, type Model } from "@/lib/models";

const externalModel = (id: string, provider: Model["provider"] = "openai"): Model => ({
  id,
  name: id,
  brand: provider === "google" ? "Google" : "OpenAI",
  type: "Text Generation",
  provider,
  source: "external",
});

describe("getExternalProviderLabel", () => {
  test("maps Claude models to Anthropic", () => {
    expect(getExternalProviderLabel(externalModel("claude-sonnet-5-5"))).toBe("Anthropic API");
    expect(getExternalProviderLabel(externalModel("claude-opus-5-5"))).toBe("Anthropic API");
    expect(getExternalProviderLabel(externalModel("claude-3-5-sonnet-latest"))).toBe(
      "Anthropic API",
    );
  });

  test("maps Gemini models to Google", () => {
    expect(getExternalProviderLabel(externalModel("gemini-3.6-flash", "google"))).toBe(
      "Google API",
    );
    expect(getExternalProviderLabel(externalModel("gemini-2.5-pro"))).toBe("Google API");
  });

  test("maps GPT and o-series models to OpenAI", () => {
    expect(getExternalProviderLabel(externalModel("gpt-5"))).toBe("OpenAI API");
    expect(getExternalProviderLabel(externalModel("gpt-4o"))).toBe("OpenAI API");
    expect(getExternalProviderLabel(externalModel("o3-mini"))).toBe("OpenAI API");
  });

  test("maps other mainstream model families to their vendor", () => {
    expect(getExternalProviderLabel(externalModel("grok-3"))).toBe("xAI API");
    expect(getExternalProviderLabel(externalModel("deepseek-chat"))).toBe("DeepSeek API");
    expect(getExternalProviderLabel(externalModel("qwen-max"))).toBe("Qwen API");
    expect(getExternalProviderLabel(externalModel("qwq-32b"))).toBe("Qwen API");
    expect(getExternalProviderLabel(externalModel("glm-4.5"))).toBe("Zhipu API");
    expect(getExternalProviderLabel(externalModel("moonshot-v1-128k"))).toBe("Moonshot API");
    expect(getExternalProviderLabel(externalModel("mistral-large-latest"))).toBe("Mistral API");
    expect(getExternalProviderLabel(externalModel("mixtral-8x22b"))).toBe("Mistral API");
    expect(getExternalProviderLabel(externalModel("llama-4-scout"))).toBe("Meta API");
    expect(getExternalProviderLabel(externalModel("doubao-pro-32k"))).toBe("ByteDance API");
  });

  test("falls back to the configured provider for unknown families", () => {
    expect(getExternalProviderLabel(externalModel("some-internal-model"))).toBe("OpenAI API");
    expect(getExternalProviderLabel(externalModel("some-model", "google"))).toBe("Google API");
  });
});

describe("getDisplayBrand", () => {
  test("infers the vendor brand from the model family", () => {
    expect(getDisplayBrand(externalModel("claude-sonnet-5-5"))).toBe("Anthropic");
    expect(getDisplayBrand(externalModel("grok-4"))).toBe("xAI");
    expect(getDisplayBrand(externalModel("gemini-3.6-flash", "google"))).toBe("Google");
    expect(getDisplayBrand(externalModel("deepseek-r1"))).toBe("DeepSeek");
    expect(getDisplayBrand(externalModel("qwen3-235b"))).toBe("Qwen");
    expect(getDisplayBrand(externalModel("glm-4.6"))).toBe("ZAI");
    expect(getDisplayBrand(externalModel("kimi-k2"))).toBe("Moonshot AI");
    expect(getDisplayBrand(externalModel("magistral-medium"))).toBe("Mistral");
    expect(getDisplayBrand(externalModel("llama-4-maverick"))).toBe("Meta");
    expect(getDisplayBrand(externalModel("doubao-1.5-pro"))).toBe("ByteDance");
    expect(getDisplayBrand(externalModel("gpt-5"))).toBe("OpenAI");
    expect(getDisplayBrand(externalModel("o4-mini"))).toBe("OpenAI");
  });

  test("does not match Cloudflare namespaced model ids", () => {
    const cloudflareModel: Model = {
      id: "@cf/mistralai/mistral-7b-instruct-v0.3",
      name: "mistral-7b-instruct-v0.3",
      brand: "Mistral",
      type: "Text Generation",
      provider: "workers-ai",
      source: "cloudflare",
    };
    expect(getDisplayBrand(cloudflareModel)).toBe("Mistral");
  });

  test("falls back to the stored brand for unknown families", () => {
    expect(getDisplayBrand(externalModel("my-custom-model"))).toBe("OpenAI");
  });
});
