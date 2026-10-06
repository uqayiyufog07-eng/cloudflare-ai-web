# Cloudflare AI Web

中文 ｜ [English](./README.en.md)

![readme.png](https://github.com/user-attachments/assets/e1c4e604-568d-4778-8780-29473619744f)

## 部署

### Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FJazee6%2Fcloudflare-ai-web&demo-title=Cloudflare%20AI%20Web&demo-url=https%3A%2F%2Fai.jaze.top)

示例：https://ai.jaze.top

> 额度用完时可能无法响应，建议自行部署

### Docker

```bash
docker run -d --name cloudflare-ai-web \
  -e CF_ACCOUNT_ID=YOUR_CF_ACCOUNT_ID \
  -e CF_WORKERS_AI_TOKEN=YOUR_CF_WORKERS_AI_TOKEN \
  -p 3000:3000 \
  --restart=always \
  jazee6/cloudflare-ai-web
```

## 特性

- 使用 Cloudflare Workers AI 快速搭建多模型AI平台
- 支持 Cloudflare AI Gateway 接入Gemini等模型
- 支持 Serverless 快速部署
- 聊天记录本地存储
- 图片附件在浏览器内自动压缩（长边不超过 1568px，单张不超过 512 KiB，每次请求最多 5 张），请求体积满足 Vercel Functions 限制
- 支持 Access Session（访问密码）保护
- 提供标准 OpenAI 格式的 API（`/v1/models`、`/v1/chat/completions`），可直接接入 OpenAI 客户端

> **注意：** 公开模式下任何人都可以使用你的推理 API。建议设置 `APP_PASSWORD` 以启用 Access Session。

## OpenAI 格式 API

本应用暴露以下 OpenAI 兼容端点，模型名与 `GET /v1/models` 返回的 `id` 一致：

| 端点                     | 说明                                   |
| ------------------------ | -------------------------------------- |
| `GET /v1/models`         | 列出可用的文本生成模型                 |
| `GET /v1/models/{id}`    | 查询单个模型                           |
| `POST /v1/chat/completions` | 聊天补全，支持 `stream` 流式输出与图像输入 |

认证方式为 `Authorization: Bearer <API Key>`。API Key 的匹配优先级：

1. `/admin` 页面中创建的动态 API Key（存储在 Workers KV 的 `API_KEYS` 命名空间中，推荐）
2. 环境变量 `OPENAI_API_KEY`；未设置时回退到 `APP_PASSWORD`
3. 两者都未设置时公开访问（若已配置 KV 存储，仍要求有效的 Bearer Key）

图像附件仅支持 base64 data URL（与网页端一致）。

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

> 工具调用（`tools`）暂不支持；`tools` 等不支持的参数会被忽略。

## API Key 管理（/admin）

访问 `/admin` 页面可以动态管理 OpenAI 格式 API 的密钥（创建 / 列出 / 删除，格式为 `sk-cfw-...`），无需重新部署即可生效：

- 登录密码取 `ADMIN_PASSWORD`；未设置时回退到 `APP_PASSWORD`；两者都未设置时该页面显示"未配置"状态
- 新创建的密钥可能需要数秒（KV 最终一致性）才在所有边缘节点生效
- 删除密钥立即失效（同样有数秒的传播延迟）
- 列表会显示每个密钥的名称、创建时间和最后使用时间（每分钟最多更新一次）

部署到 Cloudflare Workers 时需在 `wrangler.jsonc` 中配置 `API_KEYS` KV 命名空间（仓库中已包含）：

```bash
wrangler kv namespace create API_KEYS
# 将输出的 id 填入 wrangler.jsonc 的 kv_namespaces
```

## 部署说明

### 环境变量列表

| 名称                                | 描述                       | 必填         |
| ----------------------------------- | -------------------------- | ------------ |
| CF_ACCOUNT_ID                       | Cloudflare 账户ID          | ✅           |
| CF_WORKERS_AI_TOKEN                 | Cloudflare Workers AI令牌  | ✅           |
| CF_AI_GATEWAY_NAME                  | Cloudflare AI网关名称      |              |
| CF_AI_GATEWAY_TOKEN                 | Cloudflare AI网关授权令牌  | 使用网关时   |
| GOOGLE_API_KEY                      | Google AI Studio 令牌      | 使用Google时 |
| NEXT_PUBLIC_CF_AI_GATEWAY_PROVIDERS | Cloudflare AI网关提供者    |              |
| APP_PASSWORD                        | 访问密码（Access Session） |              |
| OPENAI_API_KEY                      | OpenAI 格式 API 的密钥     |              |
| ADMIN_PASSWORD                      | /admin 管理页面的登录密码  |              |

#### CF_WORKERS_AI_TOKEN

- 管理账户 - 账户API令牌 - 创建令牌 - 使用Workers AI模板创建

#### NEXT_PUBLIC_CF_AI_GATEWAY_PROVIDERS

支持的提供者：

- google

多个提供者使用逗号分隔

## 赞助

[Click Me](https://jaze.top/sponsor)

<div align="center">

<img src="https://github.com/user-attachments/assets/c194ff8a-7d86-43bf-912e-f35bb5f9d1a0" alt="赞助位1" width="300">

[Doloffer--站式数字订阅充值平台](https://doloffer.com)

主营 GPT、Claude 等 AI多类数字服务会员正版订阅，9 折优惠码 AI8888，极速发货，售后无忧

</div>
