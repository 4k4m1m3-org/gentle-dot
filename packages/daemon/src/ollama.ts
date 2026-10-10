import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const OLLAMA_PROVIDER_ID = "ollama";

export type OllamaDiscovery =
	| { status: "disabled"; models: [] }
	| { status: "unavailable"; models: []; message: string }
	| { status: "error"; models: []; message: string }
	| { status: "no_models"; models: [] }
	| { status: "available"; models: { id: string; name: string; contextWindow: number }[] };

function loopbackBaseUrl(value: string): string {
	const url = new URL(value);
	if (
		url.protocol !== "http:" ||
		url.username ||
		url.password ||
		!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
	) {
		throw new Error("Ollama must use an HTTP loopback address.");
	}
	url.pathname = url.pathname.replace(/\/$/, "").replace(/\/v1$/, "");
	url.search = "";
	url.hash = "";
	return url.toString().replace(/\/$/, "");
}

function writeModelsConfig(path: string, config: ModelsFile): void {
	const temp = `${path}.${process.pid}.tmp`;
	writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
	renameSync(temp, path);
	chmodSync(path, 0o600);
}

/** Checks Ollama's local management API. This never starts a service or downloads a model. */
export async function discoverOllama(
	baseUrl: string | undefined,
	fetcher: typeof fetch = fetch,
): Promise<OllamaDiscovery> {
	if (!baseUrl) return { status: "disabled", models: [] };
	let base: string;
	try {
		base = loopbackBaseUrl(baseUrl);
	} catch (error) {
		return { status: "error", models: [], message: (error as Error).message };
	}
	try {
		const response = await fetcher(`${base}/api/tags`, { signal: AbortSignal.timeout(1500) });
		if (!response.ok)
			return { status: "error", models: [], message: `Ollama returned HTTP ${response.status}.` };
		const payload = (await response.json()) as { models?: unknown };
		if (!Array.isArray(payload.models))
			return { status: "error", models: [], message: "Ollama returned an invalid model list." };
		const models = payload.models.flatMap((raw) => {
			if (!raw || typeof raw !== "object") return [];
			const entry = raw as { name?: unknown; model?: unknown; details?: { context_length?: unknown } };
			const id = typeof entry.name === "string" ? entry.name : entry.model;
			const contextWindow = entry.details?.context_length;
			return typeof id === "string" && id.length > 0
				? [
						{
							id,
							name: id,
							contextWindow: typeof contextWindow === "number" && contextWindow > 0 ? contextWindow : 8192,
						},
					]
				: [];
		});
		return models.length ? { status: "available", models } : { status: "no_models", models: [] };
	} catch (error) {
		return { status: "unavailable", models: [], message: (error as Error).message };
	}
}

type ModelsFile = { providers?: Record<string, unknown>; [key: string]: unknown };

/** Adds only the opted-in local provider; all other provider and model configuration is retained. */
export async function configureOllamaProvider(
	agentHome: string,
	baseUrl: string | undefined,
	fetcher: typeof fetch = fetch,
): Promise<OllamaDiscovery> {
	const discovery = await discoverOllama(baseUrl, fetcher);
	const path = join(agentHome, "models.json");
	let config: ModelsFile = {};
	if (existsSync(path)) {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			throw new Error("agent/models.json must contain an object.");
		config = parsed as ModelsFile;
	}
	const providers = { ...(config.providers ?? {}) };
	if (!baseUrl || discovery.status === "disabled") {
		const managed = providers[OLLAMA_PROVIDER_ID] as { apiKey?: unknown; baseUrl?: unknown } | undefined;
		if (
			managed?.apiKey === "ollama-local" &&
			typeof managed.baseUrl === "string" &&
			/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+\/v1$/.test(managed.baseUrl)
		) {
			delete providers[OLLAMA_PROVIDER_ID];
			writeModelsConfig(path, { ...config, providers });
		}
		return { status: "disabled", models: [] };
	}
	const normalizedBase = loopbackBaseUrl(baseUrl);
	providers[OLLAMA_PROVIDER_ID] = {
		name: "Ollama (local)",
		baseUrl: `${normalizedBase}/v1`,
		api: "openai-completions",
		// Ollama accepts a non-secret placeholder for OpenAI-compatible clients.
		apiKey: "ollama-local",
		models:
			discovery.status === "available"
				? discovery.models.map(({ id, name, contextWindow }) => ({
						id,
						name,
						reasoning: false,
						input: ["text"],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						// Uses the model's Ollama metadata, with a conservative fallback if absent.
						contextWindow,
						maxTokens: 2048,
					}))
				: [],
	};
	const next = { ...config, providers };
	writeModelsConfig(path, next);
	return discovery;
}
