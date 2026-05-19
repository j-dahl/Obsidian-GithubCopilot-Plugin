import { FALLBACK_COPILOT_MODELS } from "../providers/copilotModels";
import type { ModelInfo } from "../providers/types";
import type { PluginSettings } from "./settings";

export interface ModelOption {
  value: string;
  label: string;
}

export function getModelOptionsForSettings(
  settings: PluginSettings,
  modelCatalog: Array<Pick<ModelInfo, "id" | "name" | "publisher">>,
  copilotModels = FALLBACK_COPILOT_MODELS
): ModelOption[] {
  if (settings.backend === "github-copilot") {
    return copilotModels.map((model) => ({ value: model, label: model }));
  }
  const catalog =
    modelCatalog.length > 0
      ? modelCatalog
      : [
          {
            id: settings.githubModelName || "openai/gpt-4.1",
            name: settings.githubModelName || "openai/gpt-4.1",
            publisher: "OpenAI",
          },
        ];
  return catalog.map((model) => ({
    value: model.id,
    label: `${model.publisher || "Unknown"} / ${model.name || model.id}`,
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
