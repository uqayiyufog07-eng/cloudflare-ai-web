"use client";

import { useCallback, useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import * as v from "valibot";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
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
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";

interface ApiKeyEntry {
  token: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

type AdminState = "loading" | "unconfigured" | "unauthenticated" | "error" | "ready";

const loginSchema = v.object({ password: v.pipe(v.string(), v.minLength(1)) });
type LoginData = v.InferOutput<typeof loginSchema>;

const createSchema = v.object({ name: v.pipe(v.string(), v.minLength(1), v.maxLength(64)) });
type CreateData = v.InferOutput<typeof createSchema>;

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const copyToken = async (token: string) => {
  try {
    await navigator.clipboard.writeText(token);
    toast.add({ title: "API key copied to clipboard.", type: "success" });
  } catch {
    toast.add({ title: "Unable to copy. Please select the key manually.", type: "error" });
  }
};

export default function AdminPage() {
  const [state, setState] = useState<AdminState>("loading");
  const [keys, setKeys] = useState<ApiKeyEntry[]>([]);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<ApiKeyEntry | null>(null);
  const [creating, setCreating] = useState(false);

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

  const createForm = useForm<CreateData>({
    resolver: valibotResolver(createSchema),
    defaultValues: { name: "" },
  });

  const onCreate = async (values: CreateData) => {
    setCreating(true);
    try {
      const response = await fetch("/api/admin/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: values.name }),
      });
      if (!response.ok) {
        toast.add({ title: "Failed to create the API key.", type: "error" });
        return;
      }
      const entry = (await response.json()) as ApiKeyEntry;
      setCreated(entry);
      setKeys((previous) => [entry, ...previous]);
      createForm.reset({ name: "" });
    } catch {
      toast.add({ title: "Failed to create the API key.", type: "error" });
    } finally {
      setCreating(false);
    }
  };

  const onDelete = async (token: string) => {
    try {
      const response = await fetch(`/api/admin/keys/${encodeURIComponent(token)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        toast.add({ title: "Failed to delete the API key.", type: "error" });
        return;
      }
      setKeys((previous) => previous.filter((key) => key.token !== token));
      toast.add({ title: "API key deleted.", type: "success" });
    } catch {
      toast.add({ title: "Failed to delete the API key.", type: "error" });
    }
  };

  if (state === "unconfigured") {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="max-w-md space-y-2 text-center">
          <KeyRound className="text-muted-foreground mx-auto" aria-hidden />
          <h1 className="text-lg font-semibold">Admin is not configured</h1>
          <p className="text-muted-foreground text-sm">
            Set the ADMIN_PASSWORD (or APP_PASSWORD) environment variable to enable
            API key management for this deployment.
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
              Enter the admin password to manage API keys.
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
    <div className="mx-auto h-full w-full max-w-4xl space-y-4 overflow-y-auto px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">API keys</h1>
          <p className="text-muted-foreground text-sm">
            Bearer keys for the OpenAI-compatible endpoints (
            <code className="font-mono text-xs">/v1/chat/completions</code>,{" "}
            <code className="font-mono text-xs">/v1/models</code>). Newly created keys
            may take a few seconds to become active.
          </p>
        </div>
        <Button
          onClick={() => {
            setCreated(null);
            setCreateOpen(true);
          }}
        >
          <Plus aria-hidden />
          Create key
        </Button>
      </div>

      {state === "loading" && <p className="text-muted-foreground text-sm">Loading...</p>}

      {state === "error" && (
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm">
            Failed to load API keys. Check your connection and try again.
          </p>
          <Button variant="outline" onClick={() => void loadKeys()}>
            Retry
          </Button>
        </div>
      )}

      {state === "ready" && keys.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No API keys yet. Create one to start using the OpenAI-compatible endpoints.
        </p>
      )}

      {state === "ready" &&
        keys.map((key) => (
          <div
            key={key.token}
            className="bg-popover/50 ring-border/50 flex flex-col gap-3 rounded-xl p-4 ring-1 sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{key.name}</Badge>
              </div>
              <button
                type="button"
                className="text-muted-foreground hover:text-primary block max-w-full truncate font-mono text-xs underline-offset-4 hover:underline"
                title={key.token}
                onClick={() => void copyToken(key.token)}
              >
                {key.token}
              </button>
              <p className="text-muted-foreground text-xs">
                Created {formatDate(key.createdAt)} · Last used{" "}
                {key.lastUsedAt ? formatDate(key.lastUsedAt) : "—"}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                title="Copy key"
                onClick={() => void copyToken(key.token)}
              >
                <Copy aria-hidden />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button variant="outline" size="icon" title="Delete key">
                      <Trash2 aria-hidden />
                    </Button>
                  }
                />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this API key?</AlertDialogTitle>
                    <AlertDialogDescription>
                      &quot;{key.name}&quot; will stop working immediately. This cannot
                      be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void onDelete(key.token)}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        ))}

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setCreated(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{created ? "API key created" : "Create an API key"}</DialogTitle>
            {!created && (
              <DialogDescription>
                Give the key a name so you can recognize it later.
              </DialogDescription>
            )}
          </DialogHeader>

          {created ? (
            <div className="space-y-3">
              <p className="text-muted-foreground text-sm">
                Use this key as the Bearer token for the OpenAI-compatible endpoints:
              </p>
              <div className="bg-muted flex items-center justify-between gap-2 rounded-md p-2">
                <code className="font-mono text-xs break-all">{created.token}</code>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Copy key"
                  onClick={() => void copyToken(created.token)}
                >
                  <Copy aria-hidden />
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={createForm.handleSubmit(onCreate)}>
              <Controller
                control={createForm.control}
                name="name"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <Input placeholder="key name, e.g. my-laptop" {...field} />
                    {fieldState.error && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />
              <DialogFooter className="mt-4">
                <Button type="submit" disabled={creating}>
                  {creating ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </form>
          )}

          {created && (
            <DialogFooter>
              <Button onClick={() => setCreateOpen(false)}>Done</Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
