"use client";

import { useCallback, useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import * as v from "valibot";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { KeyRound, Plug } from "lucide-react";
import ApiKeysSection, { type ApiKeyEntry } from "@/components/admin/api-keys-section";
import ProviderSettingsSection from "@/components/admin/provider-settings-section";
import { Button } from "@/components/ui/button";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type AdminState = "loading" | "unconfigured" | "unauthenticated" | "error" | "ready";
type AdminSection = "keys" | "providers";

const SECTIONS: Array<{ id: AdminSection; label: string; icon: typeof KeyRound }> = [
  { id: "keys", label: "API Keys", icon: KeyRound },
  { id: "providers", label: "Providers", icon: Plug },
];

const loginSchema = v.object({ password: v.pipe(v.string(), v.minLength(1)) });
type LoginData = v.InferOutput<typeof loginSchema>;

export default function AdminPage() {
  const [state, setState] = useState<AdminState>("loading");
  const [keys, setKeys] = useState<ApiKeyEntry[]>([]);
  const [section, setSection] = useState<AdminSection>("keys");
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
      <div className="flex h-full items-center justify-center px-4">
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
      <div className="flex h-full items-center justify-center px-4">
        <div className="w-full max-w-xs space-y-4">
          <div className="space-y-1 text-center">
            <h1 className="text-lg font-semibold">Admin console</h1>
            <p className="text-muted-foreground text-sm">
              Enter the admin password to manage API keys and providers.
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

  return (
    <div className="flex h-full flex-col">
      <nav className="flex gap-1 overflow-x-auto px-2 py-2 lg:hidden">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
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

      <div className="mx-auto flex w-full max-w-5xl flex-1 overflow-hidden">
        <aside className="hidden w-56 shrink-0 space-y-1 border-r p-4 lg:block">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
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
        </aside>

        <main className="flex-1 overflow-y-auto px-4 py-6 lg:px-8">
          {state === "loading" && <p className="text-muted-foreground text-sm">Loading...</p>}

          {state === "error" && (
            <div className="space-y-2">
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
              <div className={section === "keys" ? "" : "hidden"}>
                <ApiKeysSection keys={keys} onKeysChange={setKeys} />
              </div>
              <div className={section === "providers" ? "" : "hidden"}>
                <ProviderSettingsSection />
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
