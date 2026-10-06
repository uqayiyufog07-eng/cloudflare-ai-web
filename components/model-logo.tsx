import {
  AnthropicLogo,
  BlackForestLabsLogo,
  ByteDanceLogo,
  DeepSeekLogo,
  GoogleLogo,
  KIMILogo,
  MetaLogo,
  MistralLogo,
  OpenAILogo,
  QWenLogo,
  XAILogo,
  ZhiPuLogo,
} from "@/components/logo";
import type { Model } from "@/lib/models";
import { getDisplayBrand } from "@/lib/models";

const DefaultLogo = () => (
  <span className="block size-4 rounded-full bg-linear-to-br from-secondary to-primary" />
);

export const ModelLogo = ({ model }: { model: Model }) => {
  switch (getDisplayBrand(model)) {
    case "Anthropic":
      return <AnthropicLogo />;
    case "Black Forest Labs":
      return <BlackForestLabsLogo />;
    case "ByteDance":
      return <ByteDanceLogo />;
    case "DeepSeek":
      return <DeepSeekLogo />;
    case "Google":
      return <GoogleLogo />;
    case "Meta":
      return <MetaLogo />;
    case "Mistral":
      return <MistralLogo />;
    case "Moonshot AI":
      return <KIMILogo />;
    case "OpenAI":
      return <OpenAILogo />;
    case "Qwen":
      return <QWenLogo />;
    case "xAI":
      return <XAILogo />;
    case "ZAI":
      return <ZhiPuLogo />;
    default:
      return <DefaultLogo />;
  }
};
