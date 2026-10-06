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
- Chat history is stored locally
- Image attachments are resized in the browser (long edge up to 1568px, at most 512 KiB each, up to 5 per request) so requests fit the Vercel Functions body limit
- Access Session protection via deployment password
- Standard OpenAI-format APIs (`/v1/models`, `/v1/chat/completions`) that any OpenAI client can consume

> **Note:** In public mode anyone can use your inference APIs. Set `APP_PASSWORD` to enable Access Session.

## OpenAI-Format APIs

The application exposes the following OpenAI-compatible endpoints. Model names match the `id` values returned by `GET /v1/models`:

| Endpoint                 | Description                                              |
| ------------------------ | -------------------------------------------------------- |
| `GET /v1/models`         | List available text generation models                    |
| `GET /v1/models/{id}`    | Retrieve a single model                                  |
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

## API Key Management (/admin)

Visit the `/admin` page to dynamically manage keys for the OpenAI-format APIs (create / list / delete, format `sk-cfw-...`). Changes take effect without redeploying:

- The login password is taken from `ADMIN_PASSWORD`, falling back to `APP_PASSWORD`; when neither is set the page shows an "unconfigured" state
- Newly created keys may take a few seconds to propagate across edge nodes (KV eventual consistency)
- Deleted keys stop working immediately (with a few seconds of propagation delay)
- The list shows each key's name, creation time, and last-used time (updated at most once per minute)

When deploying to Cloudflare Workers, the `API_KEYS` KV namespace must be configured in `wrangler.jsonc` (already included in this repo):

```bash
wrangler kv namespace create API_KEYS
# Fill the returned id into kv_namespaces in wrangler.jsonc
```

## Deployment Instructions

### Environment Variables

| Name                                | Description                      | Required     |
| ----------------------------------- | -------------------------------- | ------------ |
| CF_ACCOUNT_ID                       | Cloudflare Account ID            | ✅           |
| CF_WORKERS_AI_TOKEN                 | Cloudflare Workers AI Token      | ✅           |
| CF_AI_GATEWAY_NAME                  | Cloudflare AI Gateway Name       |              |
| CF_AI_GATEWAY_TOKEN                 | Cloudflare AI Gateway Auth Token | With gateway |
| GOOGLE_API_KEY                      | Google AI Studio Token           | With Google  |
| NEXT_PUBLIC_CF_AI_GATEWAY_PROVIDERS | Cloudflare AI Gateway Providers  |              |
| APP_PASSWORD                        | Access Password (Access Session) |              |
| OPENAI_API_KEY                      | API key for the OpenAI-format APIs |            |
| ADMIN_PASSWORD                      | Login password for the /admin console |        |

#### CF_WORKERS_AI_TOKEN

- Manage Account - Account API Tokens - Create Token - Create with Workers AI template

#### NEXT_PUBLIC_CF_AI_GATEWAY_PROVIDERS

Supported providers:

- google

Multiple providers are separated by commas

## Sponsor

[Click Me](https://jaze.top/sponsor)
