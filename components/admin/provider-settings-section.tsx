"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";

type ProviderId = "openai" | "google";

interface StoredProviderSettings {
  apiKey: string;
  baseUrl?: string;
  models?: string[];
}

type LoadState = "loading" | "unconfigured" | "error" | "ready";

const PROVIDERS: Array<{
  id: ProviderId;
  title: string;
  description: string;
  defaultBaseUrl: string;
  keyPlaceholder: string;
}> = [
  {
    id: "openai",
    title: "OpenAI",
    description:
      "Any OpenAI-compatible endpoint. Change the API address to use a relay such as https://aihubmix.com/v1.",
    defaultBaseUrl: "https://api.openai.com/v1",
    keyPlaceholder: "sk-...",
  },
  {
    id: "google",
    title: "Google",
    description:
      "The Gemini API. Settings stored here take precedence over the AI Gateway environment variables.",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    keyPlaceholder: "AIza...",
  },
];

export default function ProviderSettingsSection() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [providers, setProviders] = useState<Partial<Record<ProviderId, StoredProviderSettings>>>(
    {},
  );

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const response = await fetch("/api/admin/providers");
      if (response.status === 503) {
        setLoadState("unconfigured");
        return;
      }
      if (!response.ok) {
        throw new Error(`Unexpected status ${response.status}`);
      }
      const body = (await response.json()) as {
        providers: Partial<Record<ProviderId, StoredProviderSettings>>;
      };
      setProviders(body.providers ?? {});
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadState === "loading") {
    return <p className="text-muted-foreground text-sm">Loading...</p>;
  }

  if (loadState === "unconfigured") {
    return (
      <p className="text-muted-foreground text-sm">
        Provider settings storage is not configured for this deployment.
      </p>
    );
  }

  if (loadState === "error") {
    return (
      <div className="space-y-2">
        <p className="text-muted-foreground text-sm">
          Failed to load provider settings. Check your connection and try again.
        </p>
        <Button variant="outline" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Providers</h1>
        <p className="text-muted-foreground text-sm">
          Upstream chat providers configured here appear in the model catalog right away.
          Changes may take a few seconds to propagate to running requests.
        </p>
      </div>

      {PROVIDERS.map((provider) => (
        <ProviderCard key={provider.id} {...provider} initial={providers[provider.id]} />
      ))}
    </div>
  );
}

function ProviderCard({
  id,
  title,
  description,
  defaultBaseUrl,
  keyPlaceholder,
  initial,
}: {
  id: ProviderId;
  title: string;
  description: string;
  defaultBaseUrl: string;
  keyPlaceholder: string;
  initial?: StoredProviderSettings;
}) {
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? "");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [selected, setSelected] = useState<string[]>(initial?.models ?? []);
  const [fetched, setFetched] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [manualId, setManualId] = useState("");
  const [configured, setConfigured] = useState(!!initial);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [autoFetched, setAutoFetched] = useState(false);

  const fetchModels = useCallback(async () => {
    if (fetching) {
      return;
    }
    setFetching(true);
    setFetchError(null);
    try {
      const response = await fetch("/api/admin/providers/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: id,
          apiKey: apiKey.trim() || undefined,
          baseUrl: baseUrl.trim() || undefined,
        }),
      });
      if (!response.ok) {
        setFetchError((await response.text()) || `The request failed (${response.status}).`);
        return;
      }
      const body = (await response.json()) as { models: string[] };
      setFetched(body.models);
    } catch {
      setFetchError("Network error while fetching models.");
    } finally {
      setFetching(false);
    }
  }, [fetching, id, apiKey, baseUrl]);

  // Configured providers fetch their model list once on mount.
  useEffect(() => {
    if (configured && !autoFetched) {
      setAutoFetched(true);
      void fetchModels();
    }
  }, [configured, autoFetched, fetchModels]);

  const rows = [...new Set([...fetched, ...selected])];
  const visibleRows = rows.filter((modelId) =>
    modelId.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  const toggleModel = (modelId: string) => {
    setSelected((previous) =>
      previous.includes(modelId)
        ? previous.filter((entry) => entry !== modelId)
        : [...previous, modelId],
    );
  };

  const addManual = () => {
    const modelId = manualId.trim();
    if (!modelId) {
      return;
    }
    setSelected((previous) => (previous.includes(modelId) ? previous : [...previous, modelId]));
    setManualId("");
  };

  const onSave = async () => {
    if (saving) {
      return;
    }
    if (!apiKey.trim()) {
      toast.add({ title: "An API key is required.", type: "error" });
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/admin/providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [id]: {
            apiKey: apiKey.trim(),
            baseUrl: baseUrl.trim() || undefined,
            ...(selected.length > 0 ? { models: selected } : {}),
          },
        }),
      });
      if (!response.ok) {
        toast.add({
          title: (await response.text()) || "Failed to save the provider settings.",
          type: "error",
        });
        return;
      }
      setConfigured(true);
      toast.add({ title: `${title} settings saved.`, type: "success" });
    } catch {
      toast.add({ title: "Failed to save the provider settings.", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const onRemove = async () => {
    try {
      const response = await fetch("/api/admin/providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [id]: null }),
      });
      if (!response.ok) {
        toast.add({
          title: (await response.text()) || "Failed to remove the provider settings.",
          type: "error",
        });
        return;
      }
      setApiKey("");
      setBaseUrl("");
      setSelected([]);
      setFetched([]);
      setFilter("");
      setManualId("");
      setConfigured(false);
      setFetchError(null);
      toast.add({ title: `${title} settings removed.`, type: "success" });
    } catch {
      toast.add({ title: "Failed to remove the provider settings.", type: "error" });
    }
  };

  return (
    <div className="bg-popover/50 ring-border/50 space-y-4 rounded-xl p-4 ring-1">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">{title}</h2>
            {configured && <Badge variant="secondary">configured</Badge>}
          </div>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>

        {configured && (
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button variant="outline" size="icon" title={`Remove ${title} settings`}>
                  <Trash2 aria-hidden />
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {title} settings?</AlertDialogTitle>
                <AlertDialogDescription>
                  Models served by {title} disappear from the catalog immediately and
                  requests to them fail until the provider is configured again.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => void onRemove()}>Remove</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor={`api-key-${id}`}>
            API key
          </label>
          <Input
            id={`api-key-${id}`}
            placeholder={keyPlaceholder}
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor={`base-url-${id}`}>
            API address
          </label>
          <Input
            id={`base-url-${id}`}
            placeholder={defaultBaseUrl}
            autoComplete="off"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => void fetchModels()} disabled={fetching}>
          <RefreshCw aria-hidden className={fetching ? "animate-spin" : undefined} />
          {fetching ? "Fetching..." : "Fetch models"}
        </Button>
        <Button onClick={() => void onSave()} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>

      {fetchError && <p className="text-destructive text-sm">{fetchError}</p>}

      <div className="space-y-2">
        <p className="text-muted-foreground text-xs">
          Leave the selection empty to serve every model the endpoint lists automatically.
          {selected.length > 0 ? ` ${selected.length} model(s) selected.` : ""}
        </p>

        {rows.length > 0 && (
          <Input
            className="h-7 w-56 text-xs"
            placeholder="filter models"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        )}

        {rows.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            No models yet. Fetch models from the endpoint or add ids manually.
          </p>
        ) : (
          <ul className="max-h-64 divide-y divide-border/50 overflow-y-auto rounded-lg ring-1 ring-border/50">
            {visibleRows.map((modelId, index) => {
              const checked = selected.includes(modelId);
              const manual = !fetched.includes(modelId);
              return (
                <li key={modelId} className="flex items-center gap-2 px-2 py-1.5">
                  <input
                    type="checkbox"
                    className="size-4"
                    id={`model-${id}-${index}`}
                    checked={checked}
                    onChange={() => toggleModel(modelId)}
                  />
                  <label
                    htmlFor={`model-${id}-${index}`}
                    className="min-w-0 flex-1 truncate font-mono text-xs"
                    title={modelId}
                  >
                    {modelId}
                  </label>
                  {manual && <Badge variant="outline">manual</Badge>}
                </li>
              );
            })}
            {visibleRows.length === 0 && (
              <li className="text-muted-foreground px-2 py-1.5 text-xs">
                No models match the filter.
              </li>
            )}
          </ul>
        )}

        <div className="flex gap-2">
          <Input
            className="h-8 text-xs"
            placeholder="add a model id manually, e.g. gpt-5.2"
            value={manualId}
            onChange={(event) => setManualId(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addManual();
              }
            }}
          />
          <Button variant="outline" onClick={addManual} disabled={!manualId.trim()}>
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}
