import { type FinishReason, streamText, type TextStreamPart, type ToolSet } from "ai";
import {
  buildChunk,
  type ChatCompletionChunk,
  createCompletionId,
  openAiError,
  type OpenAiUsageInput,
  parseChatCompletionRequest,
  resolveCatalogChatModel,
  toModelMessages,
  toOpenAiFinishReason,
  toOpenAiUsage,
  toSseFrame,
} from "@/lib/openai-compat";
import { authorizeOpenAiRequest } from "@/lib/auth";
import { createChatModel, ProviderConfigurationError } from "@/lib/providers";

export const dynamic = "force-dynamic";

/**
 * Streams an AI SDK text stream as OpenAI chat.completion.chunk SSE frames.
 */
const createStreamingResponse = (
  result: { fullStream: AsyncIterable<TextStreamPart<ToolSet>> },
  base: { id: string; created: number; model: string },
  includeUsage: boolean,
): Response => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: string) => controller.enqueue(encoder.encode(payload));
      const sendChunk = (chunk: ChatCompletionChunk) => send(toSseFrame(chunk));

      let finishReason: FinishReason | undefined;
      let usage: OpenAiUsageInput;
      let failure: unknown;

      try {
        sendChunk(buildChunk(base, { role: "assistant", content: "" }, null));
        for await (const part of result.fullStream) {
          if (part.type === "text-delta") {
            sendChunk(buildChunk(base, { content: part.text }, null));
          } else if (part.type === "reasoning-delta") {
            sendChunk(buildChunk(base, { reasoning_content: part.text }, null));
          } else if (part.type === "finish") {
            finishReason = part.finishReason;
            usage = part.totalUsage;
          } else if (part.type === "error") {
            throw part.error ?? new Error("The stream failed.");
          }
        }
      } catch (error) {
        failure = error;
      }
      if (failure !== undefined) {
        console.error(failure);
      }

      // Writing can fail when the client disconnected mid-stream; the stream
      // ends either way, so the transport error is swallowed.
      try {
        if (failure !== undefined) {
          send(
            `data: ${JSON.stringify({
              error: {
                message: "The model failed to generate a response.",
                type: "server_error",
                code: null,
              },
            })}\n\n`,
          );
        } else {
          sendChunk(buildChunk(base, {}, toOpenAiFinishReason(finishReason ?? "stop")));
          if (includeUsage) {
            send(
              `data: ${JSON.stringify({
                id: base.id,
                object: "chat.completion.chunk",
                created: base.created,
                model: base.model,
                choices: [],
                usage: toOpenAiUsage(usage),
              })}\n\n`,
            );
          }
        }
        send("data: [DONE]\n\n");
        controller.close();
      } catch {
        // The client already disconnected
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      "x-accel-buffering": "no",
    },
  });
};

export async function POST(request: Request) {
  const auth = await authorizeOpenAiRequest(request);
  if (!auth.ok) {
    return auth.response;
  }

  const parsed = await parseChatCompletionRequest(request);
  if (!parsed.ok) {
    return parsed.response;
  }

  const body = parsed.data;
  const conversion = toModelMessages(body.messages);
  if (!conversion.ok) {
    return openAiError(conversion.status, conversion.message, "invalid_request_error");
  }

  const catalogModel = await resolveCatalogChatModel(body.model);
  if (!catalogModel) {
    return openAiError(
      404,
      `The model '${body.model}' does not exist.`,
      "invalid_request_error",
      "model_not_found",
    );
  }

  let chatModel: Awaited<ReturnType<typeof createChatModel>>;
  try {
    chatModel = await createChatModel(catalogModel, {});
  } catch (error) {
    if (error instanceof ProviderConfigurationError) {
      console.error(error.message);
      return openAiError(503, "The selected provider is not configured.", "server_error");
    }
    throw error;
  }

  const result = streamText({
    model: chatModel.model,
    messages: conversion.messages,
    temperature: body.temperature,
    topP: body.top_p,
    maxOutputTokens: body.max_completion_tokens ?? body.max_tokens,
    stopSequences: body.stop === undefined ? undefined : [body.stop].flat(),
    seed: body.seed,
    presencePenalty: body.presence_penalty,
    frequencyPenalty: body.frequency_penalty,
    abortSignal: request.signal,
  });

  const base = {
    id: createCompletionId(),
    created: Math.floor(Date.now() / 1000),
    model: body.model,
  };

  if (body.stream) {
    return createStreamingResponse(
      result,
      base,
      body.stream_options?.include_usage ?? false,
    );
  }

  try {
    const [text, usage, finishReason] = await Promise.all([
      result.text,
      result.usage,
      result.finishReason,
    ]);
    return Response.json({
      id: base.id,
      object: "chat.completion",
      created: base.created,
      model: base.model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: toOpenAiFinishReason(finishReason),
        },
      ],
      usage: toOpenAiUsage(usage),
    });
  } catch (error) {
    console.error(error);
    return openAiError(502, "The model failed to generate a response.", "server_error");
  }
}
