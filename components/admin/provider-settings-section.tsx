"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ModelLogo } from "@/components/model-logo";
import { DEFAULT_BASE_URLS } from "@/lib/provider-models";
import type { Model } from "@/lib/models";
import type { CustomProvider, ProviderStyle } from "@/lib/provider-settings";
import { toast } from "@/components/ui/toast";

type LoadState = "loading" | "unconfigured" | "error" | "ready";
type ProviderPatch = {
  name?: string;
  enabled?: boolean;
  apiKey?: string;
  baseUrl?: string | null;
  models?: string[] | null;
};

const STYLE_LABEL: Record<ProviderStyle, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
};

const asModel = (provider: CustomProvider, id: string): Model => ({
  id,
  name: id,
  brand: provider.style === "gemini" ? "Google" : "OpenAI",
  type: "Text Generation",
  provider: provider.id,
  providerName: provider.name,
  source: "external",
});

const groupOf = (modelId: string) => modelId.split("-")[0] || modelId;

export default function ProviderSettingsSection() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [providers, setProviders] = useState<CustomProvider[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);

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
      const body = (await response.json()) as { providers: CustomProvider[] };
      const list = body.providers ?? [];
      setProviders(list);
      setSelectedId((current) =>
        current && list.some((provider) => provider.id === current) ? current : (list[0]?.id ?? null),
      );
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return keyword
      ? providers.filter((provider) => provider.name.toLowerCase().includes(keyword))
      : providers;
  }, [providers, query]);

  const selected = providers.find((provider) => provider.id === selectedId) ?? null;

  const upsertProvider = (provider: CustomProvider) => {
    setProviders((current) => {
      const exists = current.some((entry) => entry.id === provider.id);
      return exists
        ? current.map((entry) => (entry.id === provider.id ? provider : entry))
        : [...current, provider];
    });
  };

  const patchProvider = async (id: string, patch: ProviderPatch) => {
    const response = await fetch(`/api/admin/providers/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      toast.add({
        title: (await response.text()) || "Failed to save the provider.",
        type: "error",
      });
      return null;
    }
    const body = (await response.json()) as { provider: CustomProvider };
    upsertProvider(body.provider);
    return body.provider;
  };

  const createProvider = async (name: string, style: ProviderStyle) => {
    const response = await fetch("/api/admin/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, style }),
    });
    if (!response.ok) {
      toast.add({
        title: (await response.text()) || "Failed to add the provider.",
        type: "error",
      });
      return;
    }
    const body = (await response.json()) as { provider: CustomProvider };
    setProviders((current) => [...current, body.provider]);
    setSelectedId(body.provider.id);
    setAddOpen(false);
  };

  const removeProvider = async (id: string) => {
    const response = await fetch(`/api/admin/providers/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      toast.add({ title: "Failed to remove the provider.", type: "error" });
      return;
    }
    const next = providers.filter((entry) => entry.id !== id);
    setProviders(next);
    setSelectedId((selected) => (selected === id ? (next[0]?.id ?? null) : selected));
    toast.add({ title: "Provider removed.", type: "success" });
  };

  if (loadState === "loading") {
    return <p className="text-muted-foreground p-6 text-sm">Loading...</p>;
  }

  if (loadState === "unconfigured") {
    return (
      <p className="text-muted-foreground p-6 text-sm">
        Provider settings storage is not configured for this deployment.
      </p>
    );
  }

  if (loadState === "error") {
    return (
      <div className="space-y-2 p-6">
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
    <div className="flex h-full min-h-0">
      {/* Provider list */}
      <div
        className={`${selected ? "hidden" : "flex"} w-full shrink-0 flex-col border-r lg:flex lg:w-72`}
      >
        <div className="border-b p-3">
          <div className="relative">
            <Search
              aria-hidden
              className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            />
            <Input
              className="pl-8"
              placeholder="搜索模型平台..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {filtered.length === 0 && (
            <li className="text-muted-foreground px-2 py-6 text-center text-xs">
              {query ? "没有匹配的服务商" : "还没有添加服务商"}
            </li>
          )}
          {filtered.map((provider) => {
            const active = provider.id === selectedId;
            const healthy = provider.enabled && provider.apiKey.length > 0;
            return (
              <li key={provider.id}>
                <button
                  type="button"
                  data-active={active}
                  onClick={() => setSelectedId(provider.id)}
                  className="hover:bg-muted data-[active=true]:bg-muted flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm"
                >
                  <span
                    className={`size-2 shrink-0 rounded-full ${
                      healthy ? "bg-green-500" : "bg-muted-foreground/30"
                    }`}
                    title={healthy ? "已启用" : "未配置密钥或已停用"}
                  />
                  <span className="min-w-0 flex-1 truncate">{provider.name}</span>
                  <Badge variant="outline" className="text-muted-foreground shrink-0 text-[10px]">
                    {STYLE_LABEL[provider.style]}
                  </Badge>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="border-t p-3">
          <Button variant="outline" className="w-full" onClick={() => setAddOpen(true)}>
            <Plus aria-hidden />
            添加服务商
          </Button>
        </div>
      </div>

      {/* Provider detail */}
      {selected ? (
        <ProviderDetail
          key={selected.id}
          provider={selected}
          onBack={() => setSelectedId(null)}
          onPatch={(patch) => patchProvider(selected.id, patch)}
          onDelete={() => removeProvider(selected.id)}
        />
      ) : (
        <div className="hidden flex-1 items-center justify-center p-6 lg:flex">
          <p className="text-muted-foreground text-sm">选择左侧服务商查看详情，或添加一个新服务商。</p>
        </div>
      )}

      <AddProviderDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreate={createProvider}
      />
    </div>
  );
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        checked ? "bg-green-500" : "bg-muted-foreground/30"
      }`}
    >
      <span
        className={`inline-block size-5 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function ProviderDetail({
  provider,
  onBack,
  onPatch,
  onDelete,
}: {
  provider: CustomProvider;
  onBack: () => void;
  onPatch: (patch: ProviderPatch) => Promise<CustomProvider | null>;
  onDelete: () => Promise<void>;
}) {
  const [nameDraft, setNameDraft] = useState(provider.name);
  const [apiKeyDraft, setApiKeyDraft] = useState(provider.apiKey);
  const [baseUrlDraft, setBaseUrlDraft] = useState(provider.baseUrl ?? "");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [manualId, setManualId] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    setNameDraft(provider.name);
    setApiKeyDraft(provider.apiKey);
    setBaseUrlDraft(provider.baseUrl ?? "");
  }, [provider.id, provider.name, provider.apiKey, provider.baseUrl]);

  const defaultBaseUrl = DEFAULT_BASE_URLS[provider.style];
  const models = provider.models ?? [];

  const probe = async (): Promise<string[] | null> => {
    const response = await fetch("/api/admin/providers/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: provider.id,
        ...(apiKeyDraft.trim() && apiKeyDraft.trim() !== provider.apiKey
          ? { apiKey: apiKeyDraft.trim() }
          : {}),
        ...(baseUrlDraft.trim() && baseUrlDraft.trim() !== (provider.baseUrl ?? "")
          ? { baseUrl: baseUrlDraft.trim() }
          : {}),
      }),
    });
    if (!response.ok) {
      toast.add({ title: (await response.text()) || "检测失败", type: "error" });
      return null;
    }
    return ((await response.json()) as { models: string[] }).models;
  };

  const onTest = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const ids = await probe();
      if (ids) {
        toast.add({ title: `连接正常，发现 ${ids.length} 个模型。`, type: "success" });
      }
    } finally {
      setBusy(false);
    }
  };

  const onSync = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const ids = await probe();
      if (ids === null) {
        return;
      }
      const patch: ProviderPatch = { models: ids };
      if (apiKeyDraft.trim() && apiKeyDraft.trim() !== provider.apiKey) {
        patch.apiKey = apiKeyDraft.trim();
      }
      const url = baseUrlDraft.trim();
      if (url !== (provider.baseUrl ?? "")) {
        patch.baseUrl = url || null;
      }
      const saved = await onPatch(patch);
      if (saved) {
        setCollapsed(new Set());
        toast.add({ title: `已同步 ${ids.length} 个模型。`, type: "success" });
      }
    } finally {
      setBusy(false);
    }
  };

  const addManual = async () => {
    const id = manualId.trim();
    if (!id || models.includes(id)) {
      setManualId("");
      setAddOpen(false);
      return;
    }
    const saved = await onPatch({ models: [...models, id] });
    if (saved) {
      setManualId("");
      setAddOpen(false);
      setCollapsed((current) => {
        const next = new Set(current);
        next.delete(groupOf(id));
        return next;
      });
    }
  };

  const removeModel = async (modelId: string) => {
    await onPatch({ models: models.filter((entry) => entry !== modelId) });
  };

  const groups = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const modelId of models) {
      const group = groupOf(modelId);
      map.set(group, [...(map.get(group) ?? []), modelId]);
    }
    return [...map.entries()].map(([name, entries]) => ({ name, entries }));
  }, [models]);

  const saveName = () => {
    const value = nameDraft.trim();
    if (value && value !== provider.name) {
      void onPatch({ name: value });
    } else {
      setNameDraft(provider.name);
    }
  };

  const saveApiKey = () => {
    const value = apiKeyDraft.trim();
    if (value && value !== provider.apiKey) {
      void onPatch({ apiKey: value });
    } else {
      setApiKeyDraft(provider.apiKey);
    }
  };

  const saveBaseUrl = () => {
    const value = baseUrlDraft.trim();
    if (value !== (provider.baseUrl ?? "")) {
      void onPatch({ baseUrl: value || null });
    }
  };

  const toggleGroup = (group: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onBack}
          title="返回列表"
        >
          <ArrowLeft aria-hidden />
        </Button>
        <Input
          value={nameDraft}
          onChange={(event) => setNameDraft(event.target.value)}
          onBlur={saveName}
          className="h-8 w-48 font-semibold"
          aria-label="服务商名称"
        />
        <Badge variant="outline" className="text-muted-foreground">
          {STYLE_LABEL[provider.style]}
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <Switch
            checked={provider.enabled}
            onChange={(value) => void onPatch({ enabled: value })}
            label="启用该服务商"
          />
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button variant="ghost" size="icon" title="删除服务商">
                  <Trash2 aria-hidden />
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>删除服务商“{provider.name}”？</AlertDialogTitle>
                <AlertDialogDescription>
                  该服务商下的模型会立即从目录中消失，相关请求将失败，直到重新添加。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={() => void onDelete()}>删除</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 lg:p-6">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor={`api-key-${provider.id}`}>
            API 密钥
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id={`api-key-${provider.id}`}
                className="pr-9 font-mono"
                type={showKey ? "text" : "password"}
                autoComplete="off"
                placeholder={provider.style === "gemini" ? "AIza..." : "sk-..."}
                value={apiKeyDraft}
                onChange={(event) => setApiKeyDraft(event.target.value)}
                onBlur={saveApiKey}
              />
              <button
                type="button"
                onClick={() => setShowKey((value) => !value)}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
                title={showKey ? "隐藏密钥" : "显示密钥"}
              >
                {showKey ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
              </button>
            </div>
            <Button variant="outline" onClick={() => void onTest()} disabled={busy}>
              {busy ? "检测中..." : "检测"}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor={`base-url-${provider.id}`}>
            API 地址
            <span className="text-muted-foreground ml-2 text-xs font-normal">
              留空使用 {STYLE_LABEL[provider.style]} 默认端点
            </span>
          </label>
          <Input
            id={`base-url-${provider.id}`}
            autoComplete="off"
            placeholder={defaultBaseUrl}
            value={baseUrlDraft}
            onChange={(event) => setBaseUrlDraft(event.target.value)}
            onBlur={saveBaseUrl}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">模型</h3>
            <span className="text-muted-foreground text-xs">
              {models.length > 0 ? `${models.length} 个` : "未指定时自动使用上游全部模型"}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void onSync()} disabled={busy}>
                <RefreshCw aria-hidden className={busy ? "animate-spin" : undefined} />
                同步模型
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                title="手动添加模型"
                onClick={() => setAddOpen((value) => !value)}
              >
                <Plus aria-hidden />
              </Button>
            </div>
          </div>

          {addOpen && (
            <div className="flex gap-2">
              <Input
                className="h-8 font-mono text-xs"
                autoFocus
                placeholder="手动输入模型 ID，例如 gpt-5.2"
                value={manualId}
                onChange={(event) => setManualId(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void addManual();
                  }
                  if (event.key === "Escape") {
                    setAddOpen(false);
                    setManualId("");
                  }
                }}
              />
              <Button size="sm" onClick={() => void addManual()}>
                添加
              </Button>
            </div>
          )}

          {groups.length === 0 ? (
            <p className="text-muted-foreground rounded-lg ring-1 ring-border/50 px-3 py-4 text-xs">
              暂无模型。填写 API 密钥后点击“同步模型”，或用 + 手动添加模型 ID。
            </p>
          ) : (
            <div className="space-y-1.5">
              {groups.map((group) => {
                const isCollapsed = collapsed.has(group.name);
                return (
                  <div
                    key={group.name}
                    className="overflow-hidden rounded-lg ring-1 ring-border/60"
                  >
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.name)}
                      className="hover:bg-muted/50 flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm font-medium"
                    >
                      {isCollapsed ? (
                        <ChevronRight aria-hidden className="size-4" />
                      ) : (
                        <ChevronDown aria-hidden className="size-4" />
                      )}
                      {group.name}
                      <span className="text-muted-foreground text-xs">{group.entries.length}</span>
                    </button>
                    {!isCollapsed && (
                      <ul className="border-t">
                        {group.entries.map((modelId) => (
                          <li
                            key={modelId}
                            className="group flex items-center gap-2.5 px-3 py-1.5"
                          >
                            <span className="flex size-4 items-center justify-center">
                              <ModelLogo model={asModel(provider, modelId)} />
                            </span>
                            <span className="min-w-0 flex-1 truncate font-mono text-xs" title={modelId}>
                              {modelId}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground size-7 opacity-0 group-hover:opacity-100"
                              title="移除模型"
                              onClick={() => void removeModel(modelId)}
                            >
                              <Trash2 aria-hidden className="size-3.5" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const STYLE_OPTIONS: Array<{
  style: ProviderStyle;
  title: string;
  description: string;
}> = [
  {
    style: "openai",
    title: "OpenAI 风格",
    description: "OpenAI 官方及任意 OpenAI 兼容端点（New API、AiHubMix、DeepSeek 等）",
  },
  {
    style: "gemini",
    title: "Gemini 风格",
    description: "Google Gemini API 兼容端点（generativelanguage 格式）",
  },
];

function AddProviderDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, style: ProviderStyle) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [style, setStyle] = useState<ProviderStyle>("openai");
  const [creating, setCreating] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || creating) {
      return;
    }
    setCreating(true);
    try {
      await onCreate(trimmed, style);
      setName("");
      setStyle("openai");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value);
        if (!value) {
          setName("");
          setStyle("openai");
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加服务商</DialogTitle>
          <DialogDescription>
            为上游模型平台起一个名字，并选择它的接口接入风格。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="new-provider-name">
              名称
            </label>
            <Input
              id="new-provider-name"
              autoFocus
              placeholder="例如：aimixhub、New API"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium">接入风格</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {STYLE_OPTIONS.map((option) => (
                <button
                  key={option.style}
                  type="button"
                  data-selected={style === option.style}
                  onClick={() => setStyle(option.style)}
                  className="data-[selected=true]:border-primary data-[selected=true]:ring-primary/20 space-y-1 rounded-lg border p-3 text-left ring-1 ring-transparent"
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span
                      className={`size-2 rounded-full ${
                        style === option.style ? "bg-primary" : "bg-muted-foreground/30"
                      }`}
                    />
                    {option.title}
                  </div>
                  <p className="text-muted-foreground text-xs">{option.description}</p>
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => void submit()} disabled={!name.trim() || creating}>
            {creating ? "添加中..." : "添加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
