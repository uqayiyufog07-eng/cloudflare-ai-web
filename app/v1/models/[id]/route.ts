import { authorizeOpenAiRequest } from "@/lib/auth";
import { getModelCatalog } from "@/lib/model-catalog";
import { openAiError, toOwnedBy } from "@/lib/openai-compat";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeOpenAiRequest(_request);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await params;
  const catalog = await getModelCatalog();
  const model = catalog.find((entry) => entry.id === id && entry.type === "Text Generation");

  if (!model) {
    return openAiError(404, `The model '${id}' does not exist.`, "invalid_request_error", "model_not_found");
  }

  return Response.json({
    id: model.id,
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: toOwnedBy(model.brand),
  });
}
