import { toOwnedBy } from "@/lib/openai-compat";
import { getModelCatalog } from "@/lib/model-catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  const catalog = await getModelCatalog();
  const models = catalog.filter((model) => model.type === "Text Generation");
  const created = Math.floor(Date.now() / 1000);

  return Response.json({
    object: "list",
    data: models.map((model) => ({
      id: model.id,
      object: "model",
      created,
      owned_by: toOwnedBy(model.brand),
    })),
  });
}
