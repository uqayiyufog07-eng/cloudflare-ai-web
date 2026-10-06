import { describe, expect, test } from "bun:test";
import * as v from "valibot";
import {
  chatCompletionRequestSchema,
  parseChatCompletionRequest,
  toModelMessages,
  toOpenAiFinishReason,
  toOpenAiUsage,
} from "@/lib/openai-compat";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

const parse = (messages: unknown, model = "@cf/meta/llama-3.1-8b-instruct") => {
  const result = v.safeParse(chatCompletionRequestSchema, { model, messages });
  if (!result.success) {
    return null;
  }
  return toModelMessages(result.output.messages);
};

describe("chat completion request schema", () => {
  test("accepts a minimal request and defaults stream to false", () => {
    const result = v.safeParse(chatCompletionRequestSchema, {
      model: "@cf/meta/llama-3.1-8b-instruct",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.output.stream).toBe(false);
      expect(result.output.stream_options).toBeUndefined();
    }
  });

  test("defaults include_usage to false when stream_options is provided", () => {
    const result = v.safeParse(chatCompletionRequestSchema, {
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
      stream_options: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.output.stream_options?.include_usage).toBe(false);
    }
  });

  test("rejects an empty messages array", () => {
    const result = v.safeParse(chatCompletionRequestSchema, {
      model: "m",
      messages: [],
    });
    expect(result.success).toBe(false);
  });

  test("rejects tool role messages", () => {
    const result = v.safeParse(chatCompletionRequestSchema, {
      model: "m",
      messages: [{ role: "tool", content: "result" }],
    });
    expect(result.success).toBe(false);
  });

  test("rejects a single message exceeding the context character limit", () => {
    const result = v.safeParse(chatCompletionRequestSchema, {
      model: "m",
      messages: [{ role: "user", content: "x".repeat(64_001) }],
    });
    expect(result.success).toBe(false);
  });
});

describe("toModelMessages", () => {
  test("converts system and plain user messages", () => {
    const result = parse([
      { role: "system", content: "be brief" },
      { role: "user", content: "hi" },
    ]);
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.messages).toEqual([
        { role: "system", content: "be brief" },
        { role: "user", content: "hi" },
      ]);
    }
  });

  test("converts multimodal user parts", () => {
    const result = parse([
      {
        role: "user",
        content: [
          { type: "text", text: "what is this" },
          { type: "image_url", image_url: { url: PNG_DATA_URL } },
        ],
      },
    ]);
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.messages).toEqual([
        {
          role: "user",
          content: [
            { type: "text", text: "what is this" },
            { type: "image", image: PNG_DATA_URL },
          ],
        },
      ]);
    }
  });

  test("converts assistant messages with null content", () => {
    const result = parse([{ role: "assistant", content: null }]);
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.messages).toEqual([{ role: "assistant", content: "" }]);
    }
  });

  test("rejects remote image URLs", () => {
    const result = parse([
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image_url", image_url: { url: "https://example.com/a.png" } },
        ],
      },
    ]);
    expect(result).toEqual({ ok: false, status: 400, message: expect.any(String) });
  });

  test("rejects more than five images", () => {
    const image = { type: "image_url", image_url: { url: PNG_DATA_URL } };
    const result = parse([
      { role: "user", content: [{ type: "text", text: "look" }, ...Array(6).fill(image)] },
    ]);
    expect(result).toEqual({ ok: false, status: 400, message: expect.any(String) });
  });

  test("rejects images above the byte limit", () => {
    const oversized = `data:image/png;base64,${"A".repeat(700_000)}`;
    const result = parse([
      { role: "user", content: [{ type: "image_url", image_url: { url: oversized } }] },
    ]);
    expect(result).toEqual({ ok: false, status: 413, message: expect.any(String) });
  });

  test("rejects a context exceeding the total character limit", () => {
    const result = parse([
      { role: "user", content: "x".repeat(40_000) },
      { role: "assistant", content: "y".repeat(40_000) },
    ]);
    expect(result).toEqual({ ok: false, status: 400, message: expect.any(String) });
  });
});

describe("parseChatCompletionRequest", () => {
  const request = (body: string) =>
    new Request("https://example.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

  test("returns an OpenAI-style error for malformed JSON", async () => {
    const parsed = await parseChatCompletionRequest(request("{"));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.response.status).toBe(400);
      const body = await parsed.response.json();
      expect(body.error.type).toBe("invalid_request_error");
    }
  });

  test("accepts a valid request", async () => {
    const parsed = await parseChatCompletionRequest(
      request(JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi" }] })),
    );
    expect(parsed.ok).toBe(true);
  });
});

describe("response mapping", () => {
  test("maps finish reasons to OpenAI values", () => {
    expect(toOpenAiFinishReason("stop")).toBe("stop");
    expect(toOpenAiFinishReason("length")).toBe("length");
    expect(toOpenAiFinishReason("content-filter")).toBe("content_filter");
    expect(toOpenAiFinishReason("other")).toBe("stop");
  });

  test("maps usage to OpenAI token fields", () => {
    expect(toOpenAiUsage({ inputTokens: 3, outputTokens: 5 })).toEqual({
      prompt_tokens: 3,
      completion_tokens: 5,
      total_tokens: 8,
    });
    expect(toOpenAiUsage({ inputTokens: 2, outputTokens: 4, totalTokens: 6 })).toEqual({
      prompt_tokens: 2,
      completion_tokens: 4,
      total_tokens: 6,
    });
  });
});
