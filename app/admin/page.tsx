"use client";

import { useCallback, useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import * as v from "valibot";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { Boxes, Info, KeyRound } from "lucide-react";
import ApiKeysSection, { type ApiKeyEntry } from "@/components/admin/api-keys-section";
import ProviderSettingsSection from "@/components/admin/provider-settings-section";
import { Button } from "@/components/ui/button";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type AdminState = "loading" | "unconfigured" | "unauthenticated" | "error" | "ready";
type AdminSection = "models" | "keys" | "about";

const NAV_GROUPS: Array<{
  label: string;
  items: Array<{ id: AdminSection; label: string; icon: typeof KeyRound }>;
}> = [
  { label: "设置", items: [{ id: "models", label: "模型服务", icon: Boxes }] },
  { label: "API 网关", items: [{ id: "keys", label: "API 密钥", icon: KeyRound }] },
];

const ABOUT_ITEM = { id: "about" as const, label: "关于我们", icon: Info };

const loginSchema = v.object({ password: v.pipe(v.string(), v.minLength(1)) });
type LoginData = v.InferOutput<typeof loginSchema>;

export default function AdminPage() {
  const [state, setState] = useState<AdminState>("loading");
  const [keys, setKeys] = useState<ApiKeyEntry[]>([]);
  const [section, setSection] = useState<AdminSection>("models");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadKeys = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch("/api/admin/keys");
      if (response.status === 503) {
        setState("unconfigured");
        return;
      }
      if (response.status === 401) {
        setState("unauthenticated");
        return;
      }
      if (!response.ok) {
        throw new Error(`Unexpected status ${response.status}`);
      }
      const body = (await response.json()) as { keys: ApiKeyEntry[] };
      setKeys(body.keys);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  const loginForm = useForm<LoginData>({
    resolver: valibotResolver(loginSchema),
    defaultValues: { password: "" },
  });

  const onLogin = async (values: LoginData) => {
    setSubmitting(true);
    setLoginError(null);
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: values.password }),
      });
      if (response.ok) {
        loginForm.reset({ password: "" });
        await loadKeys();
      } else if (response.status === 503) {
        setState("unconfigured");
      } else {
        setLoginError("Incorrect password.");
      }
    } catch {
      setLoginError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (state === "unconfigured") {
    return (
      <div className="flex h-svh items-center justify-center px-4">
        <div className="max-w-md space-y-2 text-center">
          <KeyRound className="text-muted-foreground mx-auto" aria-hidden />
          <h1 className="text-lg font-semibold">Admin is not configured</h1>
          <p className="text-muted-foreground text-sm">
            Set the ADMIN_PASSWORD (or APP_PASSWORD) environment variable to enable the
            admin console for this deployment.
          </p>
        </div>
      </div>
    );
  }

  if (state === "unauthenticated") {
    return (
      <div className="flex h-svh items-center justify-center px-4">
        <div className="w-full max-w-xs space-y-4">
          <div className="space-y-1 text-center">
            <h1 className="text-lg font-semibold">Admin console</h1>
            <p className="text-muted-foreground text-sm">
              Enter the admin password to manage model providers and API keys.
            </p>
          </div>
          <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-3">
            <Controller
              control={loginForm.control}
              name="password"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || !!loginError}>
                  <Input
                    aria-invalid={fieldState.invalid || !!loginError}
                    placeholder="admin password"
                    type="password"
                    {...field}
                  />
                  {fieldState.error && <FieldError errors={[fieldState.error]} />}
                  {loginError && !fieldState.error && (
                    <p className="text-destructive text-sm">{loginError}</p>
                  )}
                </Field>
              )}
            />
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  const allItems = [
    ...NAV_GROUPS.flatMap((group) => group.items),
    ABOUT_ITEM,
  ];

  return (
    <div className="flex h-svh flex-col lg:flex-row">
      <nav className="flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-2 lg:hidden">
        {allItems.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            variant={section === id ? "secondary" : "ghost"}
            size="sm"
            className="shrink-0"
            onClick={() => setSection(id)}
          >
            <Icon aria-hidden />
            {label}
          </Button>
        ))}
      </nav>

      <aside className="hidden w-52 shrink-0 flex-col gap-4 overflow-y-auto border-r p-3 lg:flex">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="space-y-1">
            <p className="text-muted-foreground px-2 text-xs font-medium">{group.label}</p>
            {group.items.map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                variant={section === id ? "secondary" : "ghost"}
                className="w-full justify-start"
                onClick={() => setSection(id)}
              >
                <Icon aria-hidden />
                {label}
              </Button>
            ))}
          </div>
        ))}
        <div className="mt-auto">
          <Button
            variant={section === "about" ? "secondary" : "ghost"}
            className="w-full justify-start"
            onClick={() => setSection("about")}
          >
            <Info aria-hidden />
            关于我们
          </Button>
        </div>
      </aside>

      <div className="min-h-0 min-w-0 flex-1">
        {state === "loading" && (
          <p className="text-muted-foreground p-6 text-sm">Loading...</p>
        )}

        {state === "error" && (
          <div className="space-y-2 p-6">
            <p className="text-muted-foreground text-sm">
              Failed to load the admin console. Check your connection and try again.
            </p>
            <Button variant="outline" onClick={() => void loadKeys()}>
              Retry
            </Button>
          </div>
        )}

        {state === "ready" && (
          <>
            {section === "models" && (
              <div className="h-full">
                <ProviderSettingsSection />
              </div>
            )}
            {section === "keys" && (
              <main className="h-full overflow-y-auto px-4 py-6 lg:px-8">
                <div className="mx-auto w-full max-w-4xl">
                  <ApiKeysSection keys={keys} onKeysChange={setKeys} />
                </div>
              </main>
            )}
            {section === "about" && (
              <main className="h-full overflow-y-auto px-4 py-6 lg:px-8">
                <div className="mx-auto w-full max-w-2xl space-y-3">
                  <h1 className="flex items-center gap-2 text-lg font-semibold">
                    <Boxes aria-hidden />
                    cloudflare-ai-web 管理后台
                  </h1>
                  <p className="text-muted-foreground text-sm">
                    在「模型服务」中添加 OpenAI 或 Gemini 接入风格的上游服务商，配置 API
                    密钥与地址并同步模型；在「API 密钥」中管理访问本站 OpenAI 兼容接口（
                    <code className="font-mono text-xs">/v1/chat/completions</code>）的 Bearer
                    密钥。
                  </p>
                </div>
              </main>
            )}
          </>
        )}
      </div>
    </div>
  );
}
