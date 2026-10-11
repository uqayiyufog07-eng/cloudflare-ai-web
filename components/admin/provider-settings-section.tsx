"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Eye,
  EyeOff,
  ExternalLink,
  ImageIcon,
  ListChecks,
  MessageSquare,
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
import { getModelBrand, getModelName, type Model, type ModelType } from "@/lib/models";
import type { CustomProvider, ProviderStyle } from "@/lib/provider-settings";
import { toast } from "@/components/ui/toast";

type LoadState = "loading" | "unconfigured" | "error" | "ready";
type ProviderPatch = {
  name?: string;
  enabled?: boolean;
  apiKey?: string;
  baseUrl?: string | null;
  models?: string[] | null;
  hiddenModels?: string[] | null;
};

/** Minimal catalog entry returned by GET /api/admin/providers/models. */
type CatalogItem = { id: string; type: ModelType };

const asWorkersModel = (id: string, type: ModelType): Model => ({
  id,
  name: getModelName(id),
  brand: getModelBrand(id),
  type,
  provider: "workers-ai",
  source: "cloudflare",
});

const STYLE_LABEL: Record<ProviderStyle, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
  "workers-ai": "Workers AI",
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
        current && list.some((provider) => provider.id === current)
          ? current
          : (list[0]?.id ?? null),
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
            // The built-in Workers AI service can also be served by the
            // CF_WORKERS_AI_TOKEN deployment secret, so a missing stored key
            // does not make it unhealthy.
            const healthy =
              provider.enabled && (provider.style === "workers-ai" || provider.apiKey.length > 0);
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
        selected.style === "workers-ai" ? (
          <WorkersAiDetail
            key={selected.id}
            provider={selected}
            onBack={() => setSelectedId(null)}
            onPatch={(patch) => patchProvider(selected.id, patch)}
          />
        ) : (
          <ProviderDetail
            key={selected.id}
            provider={selected}
            onBack={() => setSelectedId(null)}
            onPatch={(patch) => patchProvider(selected.id, patch)}
            onDelete={() => removeProvider(selected.id)}
          />
        )
      ) : (
        <div className="hidden flex-1 items-center justify-center p-6 lg:flex">
          <p className="text-muted-foreground text-sm">
            选择左侧服务商查看详情，或添加一个新服务商。
          </p>
        </div>
      )}

      <AddProviderDialog open={addOpen} onOpenChange={setAddOpen} onCreate={createProvider} />
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

/**
 * Detail panel for the built-in Cloudflare Workers AI service. Its model
 * catalog (chat + image) is synced directly from Cloudflare; the admin can
 * prune individual models (stored as a hidden-models denylist in KV) and
 * restore them later, without breaking automatic sync of new models.
 */
function WorkersAiDetail({
  provider,
  onBack,
  onPatch,
}: {
  provider: CustomProvider;
  onBack: () => void;
  onPatch: (patch: ProviderPatch) => Promise<CustomProvider | null>;
}) {
  const [apiKeyDraft, setApiKeyDraft] = useState(provider.apiKey);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [catalogStatus, setCatalogStatus] = useState<
    "loading" | "ready" | "no-token" | "no-account" | "error"
  >("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [manageOpen, setManageOpen] = useState(false);
  const [savingHidden, setSavingHidden] = useState(false);

  useEffect(() => {
    setApiKeyDraft(provider.apiKey);
  }, [provider.id, provider.apiKey]);

  const loadCatalog = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/admin/providers/models");
      if (response.status === 400) {
        setCatalogStatus("no-token");
        return;
      }
      if (response.status === 503) {
        setCatalogStatus("no-account");
        return;
      }
      if (!response.ok) {
        setCatalogStatus("error");
        return;
      }
      const body = (await response.json()) as { models: CatalogItem[] };
      setCatalogItems(body.models ?? []);
      setCatalogStatus("ready");
    } catch {
      setCatalogStatus("error");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const probe = async (): Promise<boolean> => {
    const response = await fetch("/api/admin/providers/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: provider.id,
        ...(apiKeyDraft.trim() && apiKeyDraft.trim() !== provider.apiKey
          ? { apiKey: apiKeyDraft.trim() }
          : {}),
      }),
    });
    if (!response.ok) {
      const title =
        response.status === 400
          ? "缺少 Workers AI API 令牌：请在上方填写，或设置 CF_WORKERS_AI_TOKEN。"
          : response.status === 503
            ? "当前部署缺少 CF_ACCOUNT_ID，无法调用 Workers AI。"
            : response.status === 502
              ? "Cloudflare 拒绝了该令牌，请检查权限或账户后重试。"
              : ((await response.text()) || "检测失败");
      toast.add({ title, type: "error" });
      return false;
    }
    return true;
  };

  const onTest = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      if (await probe()) {
        toast.add({
          title: "Cloudflare Workers AI 连接正常，对话与图片模型目录将自动同步。",
          type: "success",
        });
        void loadCatalog();
      }
    } finally {
      setBusy(false);
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

  const hiddenModels = useMemo(
    () => new Set(provider.hiddenModels ?? []),
    [provider.hiddenModels],
  );

  const keyword = catalogQuery.trim().toLowerCase();
  const visibleItems = useMemo(
    () =>
      catalogItems.filter(
        (item) =>
          !hiddenModels.has(item.id) &&
          (!keyword || item.id.toLowerCase().includes(keyword)),
      ),
    [catalogItems, hiddenModels, keyword],
  );
  const chatItems = visibleItems.filter((item) => item.type === "Text Generation");
  const imageItems = visibleItems.filter((item) => item.type === "Text to Image");

  const hideModel = async (modelId: string) => {
    if (hiddenModels.has(modelId)) {
      return;
    }
    await onPatch({ hiddenModels: [...hiddenModels, modelId] });
  };

  const saveHiddenModels = async (ids: string[]) => {
    setSavingHidden(true);
    try {
      const saved = await onPatch({ hiddenModels: ids.length > 0 ? ids : null });
      if (saved) {
        setManageOpen(false);
        toast.add({
          title:
            ids.length > 0
              ? `已隐藏 ${ids.length} 个模型，其他模型保持可见。`
              : "已恢复显示全部模型。",
          type: "success",
        });
      }
    } finally {
      setSavingHidden(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack} title="返回列表">
          <ArrowLeft aria-hidden />
        </Button>
        <Cloud aria-hidden className="text-muted-foreground size-4" />
        <span className="font-semibold">{provider.name}</span>
        <Badge variant="outline" className="text-muted-foreground">
          Workers AI
        </Badge>
        <Badge variant="outline" className="text-muted-foreground">
          内置
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <Switch
            checked={provider.enabled}
            onChange={(value) => void onPatch({ enabled: value })}
            label="启用 Cloudflare 免费 AI"
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 lg:p-6">
        <div className="max-w-2xl space-y-2">
          <label className="text-sm font-medium" htmlFor="api-key-workers-ai">
            Workers AI API 令牌
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id="api-key-workers-ai"
                className="pr-9 font-mono"
                type={showKey ? "text" : "password"}
                autoComplete="off"
                placeholder="留空时使用部署环境变量 CF_WORKERS_AI_TOKEN"
                value={apiKeyDraft}
                onChange={(event) => setApiKeyDraft(event.target.value)}
                onBlur={saveApiKey}
              />
              <button
                type="button"
                onClick={() => setShowKey((value) => !value)}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
                title={showKey ? "隐藏令牌" : "显示令牌"}
              >
                {showKey ? (
                  <EyeOff aria-hidden className="size-4" />
                ) : (
                  <Eye aria-hidden className="size-4" />
                )}
              </button>
            </div>
            <Button variant="outline" onClick={() => void onTest()} disabled={busy}>
              {busy ? "检测中..." : "检测"}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            在 Cloudflare 控制台
            <a
              href="https://dash.cloudflare.com/profile/api-tokens"
              target="_blank"
              rel="noreferrer"
              className="text-primary inline-flex items-center gap-0.5 underline-offset-2 hover:underline"
            >
              创建 API 令牌
              <ExternalLink aria-hidden className="size-3" />
            </a>
            （可直接使用「Workers AI」模板，授予读取与运行权限）。令牌保存在本站 KV
            中，无需重新部署即生效。
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">模型目录</h3>
            <span className="text-muted-foreground text-xs">
              {catalogStatus === "ready"
                ? `显示 ${catalogItems.length - hiddenModels.size} / ${catalogItems.length} 个${
                    hiddenModels.size > 0 ? `，已隐藏 ${hiddenModels.size}` : ""
                  }`
                : "Cloudflare 自动同步，可随时删减"}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadCatalog()}
                disabled={refreshing}
              >
                <RefreshCw aria-hidden className={refreshing ? "animate-spin" : undefined} />
                {refreshing ? "同步中..." : "刷新"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setManageOpen(true)}
                disabled={catalogStatus === "loading"}
              >
                <ListChecks aria-hidden />
                管理模型
              </Button>
            </div>
          </div>

          {catalogStatus === "loading" ? (
            <p className="text-muted-foreground rounded-lg ring-1 ring-border/50 px-3 py-4 text-xs">
              正在从 Cloudflare 同步模型目录...
            </p>
          ) : catalogStatus === "no-token" ? (
            <div className="space-y-2 rounded-lg ring-1 ring-border/50 px-3 py-4">
              <p className="text-muted-foreground text-xs">
                尚未配置 Workers AI API 令牌：请在上方填写令牌并保存，点击「检测」通过后即可查看与删减模型。
              </p>
              <Button variant="outline" size="sm" onClick={() => void loadCatalog()}>
                重新加载
              </Button>
            </div>
          ) : catalogStatus === "no-account" ? (
            <p className="text-muted-foreground rounded-lg ring-1 ring-border/50 px-3 py-4 text-xs">
              当前部署缺少 CF_ACCOUNT_ID，无法拉取 Workers AI 模型目录。
            </p>
          ) : catalogStatus === "error" ? (
            <div className="space-y-2 rounded-lg ring-1 ring-border/50 px-3 py-4">
              <p className="text-muted-foreground text-xs">
                同步模型目录失败，请检查令牌权限与网络后重试。
              </p>
              <Button variant="outline" size="sm" onClick={() => void loadCatalog()}>
                重试
              </Button>
            </div>
          ) : catalogItems.length === 0 ? (
            <p className="text-muted-foreground rounded-lg ring-1 ring-border/50 px-3 py-4 text-xs">
              未从 Cloudflare 获取到模型，请确认令牌有效后点击「刷新」。
            </p>
          ) : visibleItems.length === 0 ? (
            <p className="text-muted-foreground rounded-lg ring-1 ring-border/50 px-3 py-4 text-xs">
              {keyword
                ? "没有匹配的模型。"
                : "所有模型均已隐藏，点击「管理模型」可恢复显示。"}
            </p>
          ) : (
            <div className="space-y-3">
              <div className="relative">
                <Search
                  aria-hidden
                  className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
                />
                <Input
                  className="h-8 pl-8 text-xs"
                  placeholder="搜索模型 ID..."
                  value={catalogQuery}
                  onChange={(event) => setCatalogQuery(event.target.value)}
                />
              </div>
              <WorkersModelGroup
                title="对话模型"
                icon={MessageSquare}
                items={chatItems}
                onHide={hideModel}
              />
              <WorkersModelGroup
                title="图片模型"
                icon={ImageIcon}
                items={imageItems}
                onHide={hideModel}
              />
            </div>
          )}
        </div>

        <div className="max-w-2xl space-y-2 rounded-lg p-4 ring-1 ring-border/60">
          <h3 className="text-sm font-medium">关于 Cloudflare 免费 AI</h3>
          <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-xs">
            <li>
              对话与图片模型目录由 Cloudflare 官方自动同步；可随时删减不需要的模型，以后官方新增的模型仍会自动出现。
            </li>
            <li>免费计划每天提供 10,000 neurons 额度（UTC 0 点重置），可调用 50+ 开源模型。</li>
            <li>关闭上方开关后，所有 Cloudflare 模型会立即从模型选择器中隐藏。</li>
            <li>
              账户 ID 来自部署变量 CF_ACCOUNT_ID；令牌也可改用 secret CF_WORKERS_AI_TOKEN 配置。
            </li>
          </ul>
          <a
            href="https://developers.cloudflare.com/workers-ai/"
            target="_blank"
            rel="noreferrer"
            className="text-primary inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline"
          >
            查看 官方文档
            <ExternalLink aria-hidden className="size-3" />
          </a>
        </div>
      </div>

      <WorkersAiModelsDialog
        open={manageOpen}
        onOpenChange={(open) => {
          setManageOpen(open);
          if (!open) {
            setSavingHidden(false);
          }
        }}
        catalogItems={catalogItems}
        hiddenIds={provider.hiddenModels ?? []}
        saving={savingHidden}
        onSave={saveHiddenModels}
      />
    </div>
  );
}

function WorkersModelGroup({
  title,
  icon: Icon,
  items,
  onHide,
}: {
  title: string;
  icon: typeof MessageSquare;
  items: CatalogItem[];
  onHide: (id: string) => Promise<void>;
}) {
  const [collapsed, setCollapsed] = useState(false);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="overflow-hidden rounded-lg ring-1 ring-border/60">
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className="hover:bg-muted/50 flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm font-medium"
      >
        {collapsed ? (
          <ChevronRight aria-hidden className="size-4" />
        ) : (
          <ChevronDown aria-hidden className="size-4" />
        )}
        <Icon aria-hidden className="text-muted-foreground size-3.5" />
        {title}
        <span className="text-muted-foreground text-xs">{items.length}</span>
      </button>
      {!collapsed && (
        <ul className="max-h-72 overflow-y-auto border-t">
          {items.map((item) => (
            <li key={item.id} className="group flex items-center gap-2.5 px-3 py-1.5">
              <span className="flex size-4 items-center justify-center">
                <ModelLogo model={asWorkersModel(item.id, item.type)} />
              </span>
              <span
                className="min-w-0 flex-1 truncate font-mono text-xs"
                title={item.id}
              >
                {item.id}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground size-7 opacity-0 group-hover:opacity-100"
                title="从目录中隐藏（可在管理模型中恢复）"
                onClick={() => void onHide(item.id)}
              >
                <Trash2 aria-hidden className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
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
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncCandidates, setSyncCandidates] = useState<string[]>([]);
  const [syncMissing, setSyncMissing] = useState<string[]>([]);
  const [syncSelected, setSyncSelected] = useState<Set<string>>(new Set());
  const [syncSaving, setSyncSaving] = useState(false);

  useEffect(() => {
    setNameDraft(provider.name);
    setApiKeyDraft(provider.apiKey);
    setBaseUrlDraft(provider.baseUrl ?? "");
  }, [provider.id, provider.name, provider.apiKey, provider.baseUrl]);

  const defaultBaseUrl =
    DEFAULT_BASE_URLS[provider.style === "workers-ai" ? "openai" : provider.style];
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

  // Two-stage sync: fetch the upstream model list first, then let the user
  // pick the models to keep in the catalog. Nothing is saved until the
  // selection dialog is confirmed.
  const startSync = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const ids = await probe();
      if (ids === null) {
        return;
      }
      const upstream = new Set(ids);
      // Preserve the previous selection (including stored ids the upstream no
      // longer lists, shown separately); on a first sync everything is checked.
      const initial = models.length > 0 ? new Set(models) : new Set(ids);
      setSyncCandidates(ids);
      setSyncMissing(models.filter((id) => !upstream.has(id)));
      setSyncSelected(initial);
      setSyncOpen(true);
    } finally {
      setBusy(false);
    }
  };

  const toggleSyncModel = (id: string) => {
    setSyncSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSyncModels = (ids: string[], checked: boolean) => {
    setSyncSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (checked) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      return next;
    });
  };

  const confirmSync = async (orderedIds: string[]) => {
    setSyncSaving(true);
    try {
      const patch: ProviderPatch = { models: orderedIds };
      if (apiKeyDraft.trim() && apiKeyDraft.trim() !== provider.apiKey) {
        patch.apiKey = apiKeyDraft.trim();
      }
      const url = baseUrlDraft.trim();
      if (url !== (provider.baseUrl ?? "")) {
        patch.baseUrl = url || null;
      }
      const saved = await onPatch(patch);
      if (saved) {
        setSyncOpen(false);
        setCollapsed(new Set());
        toast.add({
          title:
            orderedIds.length > 0
              ? `已保存 ${orderedIds.length} 个模型。`
              : "已清空模型列表，将自动使用上游全部模型。",
          type: "success",
        });
      }
    } finally {
      setSyncSaving(false);
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
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack} title="返回列表">
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
                {showKey ? (
                  <EyeOff aria-hidden className="size-4" />
                ) : (
                  <Eye aria-hidden className="size-4" />
                )}
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
              <Button variant="outline" size="sm" onClick={() => void startSync()} disabled={busy}>
                <RefreshCw aria-hidden className={busy ? "animate-spin" : undefined} />
                {busy ? "获取中..." : "同步模型"}
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
                          <li key={modelId} className="group flex items-center gap-2.5 px-3 py-1.5">
                            <span className="flex size-4 items-center justify-center">
                              <ModelLogo model={asModel(provider, modelId)} />
                            </span>
                            <span
                              className="min-w-0 flex-1 truncate font-mono text-xs"
                              title={modelId}
                            >
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

      <SyncModelsDialog
        open={syncOpen}
        onOpenChange={(open) => {
          setSyncOpen(open);
          if (!open) {
            setSyncSaving(false);
          }
        }}
        providerName={provider.name}
        candidates={syncCandidates}
        missing={syncMissing}
        selected={syncSelected}
        onToggle={toggleSyncModel}
        onToggleMany={toggleSyncModels}
        saving={syncSaving}
        onConfirm={confirmSync}
      />
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
          <DialogDescription>为上游模型平台起一个名字，并选择它的接口接入风格。</DialogDescription>
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

function SyncModelsDialog({
  open,
  onOpenChange,
  providerName,
  candidates,
  missing,
  selected,
  onToggle,
  onToggleMany,
  saving,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerName: string;
  candidates: string[];
  missing: string[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleMany: (ids: string[], checked: boolean) => void;
  saving: boolean;
  onConfirm: (orderedIds: string[]) => Promise<void>;
}) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) {
      setQuery("");
    }
  }, [open]);

  const all = useMemo(() => {
    const upstream = new Set(candidates);
    return [...candidates, ...missing.filter((id) => !upstream.has(id))];
  }, [candidates, missing]);
  const missingSet = useMemo(() => new Set(missing), [missing]);

  const keyword = query.trim().toLowerCase();
  const visible = useMemo(
    () => (keyword ? all.filter((id) => id.toLowerCase().includes(keyword)) : all),
    [all, keyword],
  );

  const selectedCount = all.reduce((count, id) => count + (selected.has(id) ? 1 : 0), 0);
  const visibleCheckedCount = visible.reduce((count, id) => count + (selected.has(id) ? 1 : 0), 0);
  const allVisibleChecked = visible.length > 0 && visibleCheckedCount === visible.length;
  const orderedIds = useMemo(() => all.filter((id) => selected.has(id)), [all, selected]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>选择要同步的模型</DialogTitle>
          <DialogDescription>
            已从 {providerName} 上游获取 {candidates.length}{" "}
            个模型，勾选要在模型目录中使用的模型；只有勾选的模型会被保存。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              aria-hidden
              className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            />
            <Input
              className="pl-8"
              placeholder="搜索模型 ID..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={visible.length === 0}
            onClick={() => onToggleMany(visible, !allVisibleChecked)}
          >
            {allVisibleChecked ? "清空当前结果" : "全选当前结果"}
          </Button>
        </div>

        <div className="max-h-[46vh] min-h-32 overflow-y-auto rounded-lg ring-1 ring-border/60">
          {visible.length === 0 ? (
            <p className="text-muted-foreground px-3 py-6 text-center text-xs">没有匹配的模型</p>
          ) : (
            <ul className="divide-y">
              {visible.map((id) => {
                const checked = selected.has(id);
                const gone = missingSet.has(id);
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => onToggle(id)}
                      className="hover:bg-muted/50 flex w-full items-center gap-2.5 px-3 py-2 text-left"
                    >
                      <span
                        aria-hidden
                        className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                          checked
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-background"
                        }`}
                      >
                        {checked && <Check className="size-3" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={id}>
                        {id}
                      </span>
                      {gone && (
                        <Badge
                          variant="outline"
                          className="text-muted-foreground shrink-0 text-[10px]"
                          title="该模型已保存在本地，但上游模型列表没有返回它"
                        >
                          上游未返回
                        </Badge>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <span className="text-muted-foreground text-xs">
            已选 {selectedCount} / {all.length}
          </span>
          <span className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              取消
            </Button>
            <Button type="button" onClick={() => void onConfirm(orderedIds)} disabled={saving}>
              {saving
                ? "保存中..."
                : selectedCount > 0
                  ? `保存选择（${selectedCount}）`
                  : "清空并使用上游全部"}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Batch manager for the built-in Workers AI catalog. Checked models stay
 * visible; unchecked ids are saved into the hidden-models denylist. Ids that
 * were hidden previously but are absent from the latest Cloudflare catalog are
 * listed separately ("上游未返回") so the denylist can be cleaned up.
 */
function WorkersAiModelsDialog({
  open,
  onOpenChange,
  catalogItems,
  hiddenIds,
  saving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalogItems: CatalogItem[];
  hiddenIds: string[];
  saving: boolean;
  onSave: (hiddenIds: string[]) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | ModelType>("all");
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const entries = useMemo(() => {
    const catalogIds = new Set(catalogItems.map((item) => item.id));
    const orphans = hiddenIds.filter((id) => !catalogIds.has(id));
    return [
      ...catalogItems.map((item) => ({ id: item.id, type: item.type as ModelType, gone: false })),
      ...orphans.map((id) => ({ id, type: undefined as ModelType | undefined, gone: true })),
    ];
  }, [catalogItems, hiddenIds]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTypeFilter("all");
      const hidden = new Set(hiddenIds);
      setChecked(new Set(entries.filter((entry) => !hidden.has(entry.id)).map((e) => e.id)));
    }
  }, [open, entries, hiddenIds]);

  const keyword = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      entries.filter(
        (entry) =>
          (typeFilter === "all" || entry.type === typeFilter) &&
          (!keyword || entry.id.toLowerCase().includes(keyword)),
      ),
    [entries, keyword, typeFilter],
  );

  const visibleCheckedCount = visible.reduce(
    (count, entry) => count + (checked.has(entry.id) ? 1 : 0),
    0,
  );
  const allVisibleChecked = visible.length > 0 && visibleCheckedCount === visible.length;
  const visibleCount = entries.reduce(
    (count, entry) => count + (checked.has(entry.id) ? 1 : 0),
    0,
  );

  const toggle = (id: string) => {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleMany = (ids: string[], value: boolean) => {
    setChecked((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (value) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      return next;
    });
  };

  const confirm = () => {
    const nextHidden = entries.filter((entry) => !checked.has(entry.id)).map((entry) => entry.id);
    void onSave(nextHidden);
  };

  const filterOptions: Array<{ value: "all" | ModelType; label: string }> = [
    { value: "all", label: "全部" },
    { value: "Text Generation", label: "对话" },
    { value: "Text to Image", label: "图片" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>管理 Cloudflare 模型</DialogTitle>
          <DialogDescription>
            勾选要在模型选择器中显示的模型，取消勾选即从目录中删减；被删减的模型随时可以重新勾选恢复，不影响官方新模型自动出现。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-40 flex-1">
            <Search
              aria-hidden
              className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            />
            <Input
              className="pl-8"
              placeholder="搜索模型 ID..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-1 rounded-lg border p-0.5">
            {filterOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                data-selected={typeFilter === option.value}
                onClick={() => setTypeFilter(option.value)}
                className="data-[selected=true]:bg-muted rounded-md px-2 py-1 text-xs"
              >
                {option.label}
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={visible.length === 0}
            onClick={() => toggleMany(visible.map((entry) => entry.id), !allVisibleChecked)}
          >
            {allVisibleChecked ? "清空当前结果" : "全选当前结果"}
          </Button>
        </div>

        <div className="max-h-[46vh] min-h-32 overflow-y-auto rounded-lg ring-1 ring-border/60">
          {visible.length === 0 ? (
            <p className="text-muted-foreground px-3 py-6 text-center text-xs">没有匹配的模型</p>
          ) : (
            <ul className="divide-y">
              {visible.map((entry) => {
                const isChecked = checked.has(entry.id);
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => toggle(entry.id)}
                      className="hover:bg-muted/50 flex w-full items-center gap-2.5 px-3 py-2 text-left"
                    >
                      <span
                        aria-hidden
                        className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                          isChecked
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-background"
                        }`}
                      >
                        {isChecked && <Check className="size-3" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={entry.id}>
                        {entry.id}
                      </span>
                      {entry.gone && (
                        <Badge
                          variant="outline"
                          className="text-muted-foreground shrink-0 text-[10px]"
                          title="该模型已被隐藏，但当前 Cloudflare 目录没有返回它；勾选可清除这条隐藏记录"
                        >
                          上游未返回
                        </Badge>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <span className="text-muted-foreground text-xs">
            显示中 {visibleCount} / {entries.length}
          </span>
          <span className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              取消
            </Button>
            <Button type="button" onClick={confirm} disabled={saving}>
              {saving ? "保存中..." : "保存"}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
