import { FALLBACK_COPILOT_MODELS } from "../providers/copilotModels";
import type { ModelInfo } from "../providers/types";
import type { PluginSettings } from "./settings";

export const FALLBACK_GITHUB_MODELS = ["openai/gpt-4.1", "openai/gpt-4o", "openai/gpt-4o-mini"];

export interface ModelOption {
  value: string;
  label: string;
}

export function getModelOptionsForSettings(
  settings: PluginSettings,
  modelCatalog: Array<
    Pick<ModelInfo, "id" | "name" | "publisher" | "supportsTools" | "supportsStreaming">
  >,
  copilotModels = FALLBACK_COPILOT_MODELS
): ModelOption[] {
  if (settings.backend === "github-copilot") {
    return copilotModels.map((model) => ({ value: model, label: model }));
  }
  const catalog =
    modelCatalog.length > 0
      ? modelCatalog
      : FALLBACK_GITHUB_MODELS.map((id) => ({
          id,
          name: id.split("/").pop() ?? id,
          publisher: id.split("/")[0] ?? "Unknown",
          supportsTools: id !== "openai/gpt-4o-mini",
          supportsStreaming: true,
        }));
  return catalog.map((model) => ({
    value: model.id,
    label: `${model.publisher || "Unknown"} / ${model.name || model.id}${capabilityBadges(model)}`,
  }));
}

export function getChatModelOptions(settings: PluginSettings): ModelOption[] {
  if (settings.backend === "github-copilot") {
    return FALLBACK_COPILOT_MODELS.map((model) => ({ value: model, label: model }));
  }
  if (settings.backend === "github-models") {
    const value = settings.selectedModel || settings.githubModelName || "openai/gpt-4.1";
    return [{ value, label: value }];
  }
  const value =
    settings.backend === "azure-foundry"
      ? settings.azureDeploymentName || settings.selectedModel
      : settings.selectedModel || settings.classicEndpoint;
  return value ? [{ value, label: value }] : [];
}

function capabilityBadges(model: Pick<ModelInfo, "supportsTools" | "supportsStreaming">): string {
  const badges = [model.supportsTools ? "🔧" : "", model.supportsStreaming ? "🌊" : ""].filter(
    Boolean
  );
  return badges.length > 0 ? ` ${badges.join(" ")}` : "";
}
