import { expect, test } from "bun:test";
import { GET as getModels } from "@/app/v1/models/route";
import { POST as postCompletions } from "@/app/v1/chat/completions/route";

const completionRequest = (body: string) =>
  new Request("https://example.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

test("completions rejects malformed JSON with an OpenAI-style error", async () => {
  const response = await postCompletions(completionRequest("{"));
  expect(response.status).toBe(400);
  const body = await response.json();
  expect(body.error.type).toBe("invalid_request_error");
});

test("completions rejects requests without messages", async () => {
  const response = await postCompletions(completionRequest(JSON.stringify({ model: "m" })));
  expect(response.status).toBe(400);
});

test("completions reports unknown models as model_not_found", async () => {
  const response = await postCompletions(
    completionRequest(
      JSON.stringify({
        model: "@cf/nonexistent/model",
        messages: [{ role: "user", content: "hi" }],
      }),
    ),
  );
  expect(response.status).toBe(404);
  const body = await response.json();
  expect(body.error.code).toBe("model_not_found");
});

test("models returns an OpenAI-style list", async () => {
  const response = await getModels();
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.object).toBe("list");
  expect(Array.isArray(body.data)).toBe(true);
});
