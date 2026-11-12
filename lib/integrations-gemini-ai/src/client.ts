import { GoogleGenAI, type GoogleGenAIOptions } from "@google/genai";

type ServiceAccountCredentials = {
  type: "service_account";
  client_email: string;
  private_key: string;
};

let client: GoogleGenAI | undefined;

function serviceAccountCredentials(): ServiceAccountCredentials | undefined {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return undefined;

  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return undefined;
    const candidate = value as Record<string, unknown>;
    if (
      candidate.type !== "service_account" ||
      typeof candidate.client_email !== "string" ||
      typeof candidate.private_key !== "string"
    ) {
      return undefined;
    }
    return candidate as ServiceAccountCredentials;
  } catch {
    return undefined;
  }
}

export function vertexAIConfigured(): boolean {
  return Boolean(
    process.env.GCP_PROJECT_ID?.trim() &&
      process.env.GOOGLE_CLOUD_LOCATION?.trim() &&
      serviceAccountCredentials(),
  );
}

export function getVertexGeminiClient(): GoogleGenAI {
  if (client) return client;

  const project = process.env.GCP_PROJECT_ID?.trim();
  const location = process.env.GOOGLE_CLOUD_LOCATION?.trim();
  const credentials = serviceAccountCredentials();
  if (!project || !location || !credentials) {
    throw new Error(
      "Vertex AI Gemini needs GCP_PROJECT_ID, GOOGLE_CLOUD_LOCATION, and a valid GOOGLE_SERVICE_ACCOUNT_JSON service-account key.",
    );
  }

  const options: GoogleGenAIOptions = {
    vertexai: true,
    project,
    location,
    googleAuthOptions: {
      credentials:
        credentials as unknown as NonNullable<
          GoogleGenAIOptions["googleAuthOptions"]
        >["credentials"],
    },
  };
  client = new GoogleGenAI(options);
  return client;
}
