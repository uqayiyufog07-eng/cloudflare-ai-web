/**
 * OpenAI-compatible Chat Completions support.
 *
 * Translates the standard OpenAI request/response format to and from the AI SDK
 * primitives used by this application, so any OpenAI client can consume the
 * deployed Model Catalog.
 */
import type { FinishReason, ModelMessage } from "ai";
import * as v from "valibot";
import {
  MODEL_CONTEXT_MAX_CHARS,
  MODEL_CONTEXT_MAX_IMAGES,
  MODEL_CONTEXT_MAX_MESSAGES,
} from "@/lib/model-context";
import { getCatalogModel } from "@/lib/model-catalog";
import { getImageDataUrlSize, MAX_IMAGE_BYTES, readRequestBody } from "@/lib/request-limits";

// ---- Request schema ----

const textContentSchema = v.pipe(v.string(), v.maxLength(MODEL_CONTEXT_MAX_CHARS));

const contentPartSchema = v.variant("type", [
  v.object({
    type: v.literal("text"),
    text: textContentSchema,
  }),
  v.object({
    type: v.literal("image_url"),
    image_url: v.object({
      url: v.pipe(v.string(), v.minLength(1)),
    }),
  }),
]);

const assistantContentSchema = v.nullable(
  v.union([
    textContentSchema,
    v.array(
      v.object({
        type: v.literal("text"),
        text: v.pipe(v.string(), v.maxLength(MODEL_CONTEXT_MAX_CHARS)),
      }),
    ),
  ]),
);

const messageSchema = v.variant("role", [
  v.object({
    role: v.literal("system"),
    content: textContentSchema,
  }),
  v.object({
    role: v.literal("user"),
    content: v.union([textContentSchema, v.array(contentPartSchema)]),
  }),
  v.object({
    role: v.literal("assistant"),
    content: assistantContentSchema,
  }),
]);

// Standard OpenAI fields that the deployed providers cannot serve are accepted
// for compatibility and silently ignored (e.g. tools, n, response_format).
export const chatCompletionRequestSchema = v.object({
  model: v.pipe(v.string(), v.minLength(1)),
  messages: v.pipe(
    v.array(messageSchema),
    v.minLength(1),
    v.maxLength(MODEL_CONTEXT_MAX_MESSAGES),
  ),
  stream: v.optional(v.boolean(), false),
  stream_options: v.optional(
    v.object({
      include_usage: v.optional(v.boolean(), false),
    }),
  ),
  temperature: v.optional(v.number()),
  top_p: v.optional(v.number()),
  max_tokens: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  max_completion_tokens: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  stop: v.optional(
    v.union([v.pipe(v.string(), v.minLength(1)), v.array(v.pipe(v.string(), v.minLength(1)))]),
  ),
  seed: v.optional(v.pipe(v.number(), v.integer())),
  presence_penalty: v.optional(v.number()),
  frequency_penalty: v.optional(v.number()),
});

export type ChatCompletionRequest = v.InferOutput<typeof chatCompletionRequestSchema>;

export type ParsedChatCompletionRequest =
  | { ok: true; data: ChatCompletionRequest }
  | { ok: false; response: Response };

// ---- Errors ----

export const openAiError = (
  status: number,
  message: string,
  type: string,
  code: string | null = null,
) =>
  new Response(JSON.stringify({ error: { message, type, code } }), {
    status,
    headers: { "content-type": "application/json" },
  });

export const openAiBadRequest = (message: string) =>
  openAiError(400, message, "invalid_request_error");

// ---- Model resolution ----

export const toOwnedBy = (brand: string) => brand.toLowerCase().replaceAll(" ", "-");

/**
 * Resolves a request's model id to a catalog chat model, searching Cloudflare
 * models first and external models (e.g. Gemini via the AI Gateway) second.
 */
export const resolveCatalogChatModel = async (id: string) =>
  (await getCatalogModel(id, "Text Generation", "workers-ai")) ??
  (await getCatalogModel(id, "Text Generation", "google"));

// ---- Message conversion ----

export type ConversionResult =
  | { ok: true; messages: ModelMessage[] }
  | { ok: false; status: 400 | 413; message: string };

const dataUrlMediaType = (url: string): string => {
  const match = /^data:([^;,]+)[;,]/.exec(url);
  return match?.[1] ?? "";
};

const assistantText = (
  content: string | null | undefined | Array<{ type: "text"; text: string }>,
): string => {
  if (typeof content === "string") {
    return content;
  }
  if (content === null || content === undefined) {
    return "";
  }
  return content.map((part) => part.text).join("");
};

/**
 * Converts OpenAI chat messages into AI SDK model messages while enforcing the
 * same image and context limits as the built-in chat API.
 */
export const toModelMessages = (messages: ChatCompletionRequest["messages"]): ConversionResult => {
  const modelMessages: ModelMessage[] = [];
  let totalChars = 0;
  let imageCount = 0;

  for (const message of messages) {
    if (message.role === "system") {
      totalChars += message.content.length;
      modelMessages.push({ role: "system", content: message.content });
      continue;
    }

    if (message.role === "assistant") {
      const text = assistantText(message.content);
      totalChars += text.length;
      modelMessages.push({ role: "assistant", content: text });
      continue;
    }

    if (typeof message.content === "string") {
      totalChars += message.content.length;
      modelMessages.push({ role: "user", content: message.content });
      continue;
    }

    const parts: Array<{ type: "text"; text: string } | { type: "image"; image: string }> = [];
    for (const part of message.content) {
      if (part.type === "text") {
        totalChars += part.text.length;
        parts.push({ type: "text", text: part.text });
        continue;
      }

      imageCount++;
      if (imageCount > MODEL_CONTEXT_MAX_IMAGES) {
        return {
          ok: false,
          status: 400,
          message: `At most ${MODEL_CONTEXT_MAX_IMAGES} image attachments are supported per request.`,
        };
      }

      const { url } = part.image_url;
      if (!url.startsWith("data:")) {
        return {
          ok: false,
          status: 400,
          message: "Only base64 data URLs are supported for image_url attachments.",
        };
      }

      const imageSize = getImageDataUrlSize(url, dataUrlMediaType(url));
      if (imageSize === null) {
        return { ok: false, status: 400, message: "Invalid image_url attachment." };
      }
      if (imageSize > MAX_IMAGE_BYTES) {
        return { ok: false, status: 413, message: "Image attachment is too large." };
      }

      parts.push({ type: "image", image: url });
    }
    modelMessages.push({ role: "user", content: parts });
  }

  if (totalChars > MODEL_CONTEXT_MAX_CHARS) {
    return {
      ok: false,
      status: 400,
      message: `The request exceeds the maximum context length of ${MODEL_CONTEXT_MAX_CHARS} characters.`,
    };
  }

  return { ok: true, messages: modelMessages };
};

// ---- Request parsing ----

/** Reads and validates a chat completion request body, returning OpenAI-style errors. */
export const parseChatCompletionRequest = async (
  request: Request,
): Promise<ParsedChatCompletionRequest> => {
  const bodyResult = await readRequestBody(request);
  if (!bodyResult.ok) {
    return { ok: false, response: openAiBadRequest(bodyResult.message) };
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyResult.text);
  } catch {
    return {
      ok: false,
      response: openAiBadRequest("The request body must be valid JSON."),
    };
  }

  const parsed = v.safeParse(chatCompletionRequestSchema, body);
  if (!parsed.success) {
    const issue = parsed.issues[0];
    return {
      ok: false,
      response: openAiBadRequest(`Invalid request: ${issue?.message ?? "unrecognized format"}`),
    };
  }

  return { ok: true, data: parsed.output };
};

// ---- Response mapping ----

export const createCompletionId = () => `chatcmpl-${crypto.randomUUID()}`;

export type OpenAiUsageInput = {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  totalTokens?: number | undefined;
} | undefined;

export const toOpenAiUsage = (usage: OpenAiUsageInput) => {
  const promptTokens = usage?.inputTokens ?? 0;
  const completionTokens = usage?.outputTokens ?? 0;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: usage?.totalTokens ?? promptTokens + completionTokens,
  };
};

export const toOpenAiFinishReason = (
  reason: FinishReason,
): "stop" | "length" | "content_filter" => {
  if (reason === "length") {
    return "length";
  }
  if (reason === "content-filter") {
    return "content_filter";
  }
  return "stop";
};

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: "assistant";
      content?: string;
      reasoning_content?: string;
    };
    finish_reason: string | null;
  }>;
}

/** Builds the SSE frame for one chat.completion.chunk payload. */
export const toSseFrame = (chunk: ChatCompletionChunk) =>
  `data: ${JSON.stringify(chunk)}\n\n`;

export const buildChunk = (
  base: { id: string; created: number; model: string },
  delta: ChatCompletionChunk["choices"][number]["delta"],
  finishReason: string | null,
): ChatCompletionChunk => ({
  id: base.id,
  object: "chat.completion.chunk",
  created: base.created,
  model: base.model,
  choices: [{ index: 0, delta, finish_reason: finishReason }],
});
