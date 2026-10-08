# Cloudflare AI Web

[中文](./README.md) ｜ English

![readme.png](https://github.com/user-attachments/assets/e1c4e604-568d-4778-8780-29473619744f)

## Deployment

### Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FJazee6%2Fcloudflare-ai-web&demo-title=Cloudflare%20AI%20Web&demo-url=https%3A%2F%2Fai.jaze.top)

Example: https://ai.jaze.top

> It may not respond when the quota is used up, it is recommended to deploy it yourself

### Docker

```bash
docker run -d --name cloudflare-ai-web \
  -e CF_ACCOUNT_ID=YOUR_CF_ACCOUNT_ID \
  -e CF_WORKERS_AI_TOKEN=YOUR_CF_WORKERS_AI_TOKEN \
  -p 3000:3000 \
  --restart=always \
  jazee6/cloudflare-ai-web
```

## Features

- Quickly build a multimodel AI platform using Cloudflare Workers AI
- Support Cloudflare AI Gateway to access models such as Gemini
- Support fast deployment with Serverless
- Text conversation history is stored in Cloudflare D1 and shared across devices signed in with the same access password; image generation history stays local in the browser
- Image attachments are resized in the browser (long edge up to 1568px, at most 512 KiB each, up to 5 per request) so requests fit the Vercel Functions body limit
- Access Session protection via deployment password
- Standard OpenAI-format APIs (`/v1/models`, `/v1/chat/completions`) that any OpenAI client can consume

> **Note:** In public mode anyone can use your inference APIs. Set `APP_PASSWORD` to enable Access Session.

## OpenAI-Format APIs

The application exposes the following OpenAI-compatible endpoints. Model names match the `id` values returned by `GET /v1/models`:

| Endpoint                    | Description                                            |
| --------------------------- | ------------------------------------------------------ |
| `GET /v1/models`            | List available text generation models                  |
| `GET /v1/models/{id}`       | Retrieve a single model                                |
| `POST /v1/chat/completions` | Chat completions with `stream` support and image input |

Authentication uses `Authorization: Bearer <API Key>`. API keys are matched in the following priority order:

1. Dynamic API keys created on the `/admin` page (stored in the `API_KEYS` Workers KV namespace, recommended)
2. The `OPENAI_API_KEY` environment variable, falling back to `APP_PASSWORD` when unset
3. Public access when neither is set (a valid Bearer key is still required once the KV store is configured)

Image attachments only support base64 data URLs (same as the web UI).

```bash
curl https://your-domain.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "@cf/meta/llama-3.1-8b-instruct",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

> Function calling (`tools`) is not supported; unsupported parameters such as `tools` are ignored.

## Admin Console (/admin)

The `/admin` page has a left navigation with "Settings - Model Providers", "API Gateway - API Keys", and "About". The login password is taken from `ADMIN_PASSWORD`, falling back to `APP_PASSWORD`; when neither is set the page shows an "unconfigured" state.

### API Keys

Dynamically manage keys for the OpenAI-format APIs (create / list / delete, format `sk-cfw-...`). Changes take effect without redeploying:

- Newly created keys may take a few seconds to propagate across edge nodes (KV eventual consistency)
- Deleted keys stop working immediately (with a few seconds of propagation delay)
- The list shows each key's name, creation time, and last-used time (updated at most once per minute)

### Model Providers

A three-pane console for upstream model platforms. **No providers are preset** — every provider is added by you, and its models appear in the web catalog and `/v1/models` right away:

- Click **Add provider** at the bottom of the list, give it a name and pick an integration style:
  - **OpenAI style**: OpenAI itself and any OpenAI-compatible endpoint (New API, AiHubMix, DeepSeek, ...), default address `https://api.openai.com/v1`
  - **Gemini style**: Google Gemini API compatible endpoints, default address `https://generativelanguage.googleapis.com/v1beta`
- The detail pane edits the name, the enable toggle, the API key (show/hide and a **Test** button) and the API address (leave empty for the default endpoint)
- Click **Sync models** to pull the upstream model list (grouped by model family), or use **+** to add model ids manually; an empty model list automatically serves every chat model the endpoint returns
- Every change is saved immediately and propagates within a few seconds (KV eventual consistency); legacy fixed OpenAI/Google settings are migrated into providers automatically on first open

> Note: the API keys entered here are the credentials this deployment uses to call the upstream services. They are unrelated to the keys that log into this site (`OPENAI_API_KEY`, `APP_PASSWORD`, and the keys created under API Keys).

When deploying to Cloudflare Workers, the `API_KEYS` KV namespace must be configured in `wrangler.jsonc` (already included in this repo; it stores both API keys and provider settings):

```bash
wrangler kv namespace create API_KEYS
# Fill the returned id into kv_namespaces in wrangler.jsonc
```

### Conversation History (D1)

Text conversations (sessions and messages) are stored in Cloudflare D1 and shared by every device that holds the access password. The `/image` generation history still lives only in browser IndexedDB. Create the database and apply migrations before the first deploy (`wrangler.jsonc` already ships the `DB` binding, and `migrations/` contains the schema SQL):

```bash
wrangler d1 create cloudflare-ai-web
# Fill the returned database_id into d1_databases in wrangler.jsonc

wrangler d1 migrations apply cloudflare-ai-web --local   # local dev database
wrangler d1 migrations apply cloudflare-ai-web --remote  # production database (run before deploying)
```

> The D1 binding is required to start or load a conversation. When it is missing (e.g. Vercel / Docker deployments), the conversation endpoints return 503: the UI shows an error instead of writing data locally and history is unavailable. Text conversations kept in IndexedDB by older versions are not migrated; the Dexie schema auto-upgrades to v4 and drops the local session table, while Image History is untouched.

## Deployment Instructions

### Environment Variables

| Name                                | Description                           | Required     |
| ----------------------------------- | ------------------------------------- | ------------ |
| CF_ACCOUNT_ID                       | Cloudflare Account ID                 | ✅           |
| CF_WORKERS_AI_TOKEN                 | Cloudflare Workers AI Token           | ✅           |
| CF_AI_GATEWAY_NAME                  | Cloudflare AI Gateway Name            |              |
| CF_AI_GATEWAY_TOKEN                 | Cloudflare AI Gateway Auth Token      | With gateway |
| GOOGLE_API_KEY                      | Google AI Studio Token                | With Google  |
| NEXT_PUBLIC_CF_AI_GATEWAY_PROVIDERS | Cloudflare AI Gateway Providers       |              |
| APP_PASSWORD                        | Access Password (Access Session)      |              |
| OPENAI_API_KEY                      | API key for the OpenAI-format APIs    |              |
| ADMIN_PASSWORD                      | Login password for the /admin console |              |

#### CF_WORKERS_AI_TOKEN

- Manage Account - Account API Tokens - Create Token - Create with Workers AI template

#### NEXT_PUBLIC_CF_AI_GATEWAY_PROVIDERS

Supported providers:

- google

Multiple providers are separated by commas

## Sponsor

[Click Me](https://jaze.top/sponsor)
