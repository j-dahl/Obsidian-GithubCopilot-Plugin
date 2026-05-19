export const FALLBACK_COPILOT_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4.1",
  "o3",
  "o4-mini",
  "claude-3.5-sonnet",
  "claude-3.7-sonnet",
];

export type CopilotModelsSource = "live" | "fallback";

export interface CopilotSessionTokenStore {
  getValidSessionToken(): Promise<{ token: string; baseUrl: string }>;
}

export interface CopilotModelsResult {
  models: string[];
  source: CopilotModelsSource;
}

interface CopilotModelApiEntry {
  id?: unknown;
  vendor?: unknown;
  model_picker_enabled?: unknown;
  capabilities?: {
    supports?: {
      tool_calls?: unknown;
    };
  };
}

interface CopilotModelsApiResponse {
  data?: unknown;
}

function isModelEntry(value: unknown): value is CopilotModelApiEntry {
  return Boolean(value && typeof value === "object");
}

function isPickerModel(model: CopilotModelApiEntry): boolean {
  if (typeof model.id !== "string" || model.id.length === 0) return false;
  if (model.model_picker_enabled === false) return false;
  const supportsToolCalls = model.capabilities?.supports?.tool_calls;
  return supportsToolCalls === undefined || supportsToolCalls === true;
}

export async function getCopilotModels(
  sessionTokenStore: CopilotSessionTokenStore | undefined,
  fetcher: typeof fetch = globalThis.fetch
): Promise<CopilotModelsResult> {
  if (!sessionTokenStore) return { models: [...FALLBACK_COPILOT_MODELS], source: "fallback" };
  try {
    const session = await sessionTokenStore.getValidSessionToken();
    const response = await fetcher(`${session.baseUrl.replace(/\/$/, "")}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.token}`,
        Accept: "application/json",
        "Copilot-Integration-Id": "vscode-chat",
      },
    });
    if (!response.ok) throw new Error(`Copilot models request failed with HTTP ${response.status}`);
    const body = (await response.json()) as CopilotModelsApiResponse;
    const entries = Array.isArray(body.data) ? body.data.filter(isModelEntry) : [];
    const live = entries.filter(isPickerModel).map((model) => model.id as string);
    if (live.length === 0) throw new Error("Copilot models response did not include model ids");
    return { models: Array.from(new Set(live)), source: "live" };
  } catch {
    return { models: [...FALLBACK_COPILOT_MODELS], source: "fallback" };
  }
}
