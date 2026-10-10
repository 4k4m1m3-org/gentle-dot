import { MAX_VOICE_TEXT } from "@gentle-dot/protocol";
import type { Send } from "./components/types.ts";
import { speakableText } from "./speech.ts";
import type { DotState } from "./store.ts";

export type BackgroundPhase =
	| "idle"
	| "listening"
	| "transcribing"
	| "processing"
	| "speaking"
	| "error"
	| "cancelled";
export interface VoiceModeConfig {
	enabled: boolean;
	spokenReplies: boolean;
	silenceMs: number;
	maxCaptureMs: number;
	initialWaitMs: number;
	levelThreshold: number;
	responseTimeoutMs: number;
}
export interface VoiceModeView {
	phase: BackgroundPhase;
	level: number;
	note: string;
}
export interface VoiceModeHost {
	start(): Promise<void>;
	stop(): Promise<string>;
	cancel(): Promise<void>;
	play(data: string): Promise<void>;
	stopPlaying(): Promise<void>;
	send: Send;
	muted(): boolean;
	now(): number;
	id(): string;
	changed(view: VoiceModeView): void;
}
/** One owner, explicit deadlines, and a generation fence around every asynchronous result. */
export class BackgroundVoice {
	view: VoiceModeView = { phase: "idle", level: 0, note: "" };
	private generation = 0;
	private initialized = false;
	private ownsCapture = false;
	private stopRequested = false;
	private started = 0;
	private lastLoud = 0;
	private heard = false;
	private deadline = 0;
	private config?: VoiceModeConfig;
	private state?: DotState;
	private conversation?: string;
	private before = new Set<string>();
	private requestId?: string;
	private speechId?: string;
	private chunks: string[] = [];
	private submitted = false;
	private submittedText = "";
	private host: VoiceModeHost;
	constructor(host: VoiceModeHost) {
		this.host = host;
	}
	private set(phase: BackgroundPhase, note = "") {
		this.view = { phase, level: 0, note };
		this.host.changed(this.view);
	}
	private available() {
		return (
			this.state?.connection === "open" &&
			this.state.agentState === "idle" &&
			this.state.asks.length === 0 &&
			!!this.state.conversationId
		);
	}
	async toggle(config: VoiceModeConfig) {
		if (this.view.phase === "listening") {
			if (!this.initialized) {
				this.stopRequested = true;
				return;
			}
			await this.stop();
			return;
		}
		if (["transcribing", "processing", "speaking"].includes(this.view.phase)) {
			this.cancel();
			return;
		}
		if (!config.enabled) {
			this.fail("Voice Mode está deshabilitado.");
			return;
		}
		if (!this.available()) {
			this.fail("El asistente no está disponible o necesita tu atención.");
			return;
		}
		const generation = ++this.generation;
		this.config = config;
		this.conversation = this.state?.conversationId;
		this.initialized = false;
		this.stopRequested = false;
		this.heard = false;
		this.deadline = this.host.now() + 120000;
		this.set("listening", "Preparando el micrófono…");
		this.ownsCapture = true;
		try {
			await this.host.start();
			if (generation !== this.generation) return;
			this.initialized = true;
			this.started = this.host.now();
			this.lastLoud = this.started;
			this.set("listening");
			if (this.stopRequested) await this.stop();
		} catch (error) {
			if (generation === this.generation) {
				this.ownsCapture = false;
				this.fail(String(error));
			}
		}
	}
	level(level: number) {
		if (this.view.phase !== "listening" || !this.initialized) return;
		this.view = { ...this.view, level };
		this.host.changed(this.view);
		if (level >= (this.config?.levelThreshold ?? 0.32)) {
			this.heard = true;
			this.lastLoud = this.host.now();
		}
	}
	tick() {
		const now = this.host.now();
		if (this.view.phase === "listening" && this.initialized && this.config) {
			if (!this.heard && now - this.started >= this.config.initialWaitMs) {
				this.fail("No se detectó voz.");
				return;
			}
			if (
				now - this.started >= this.config.maxCaptureMs ||
				(this.heard && now - this.lastLoud >= this.config.silenceMs)
			)
				void this.stop();
		} else if (
			["listening", "transcribing", "processing", "speaking"].includes(this.view.phase) &&
			now > this.deadline
		)
			this.fail("Se agotó el tiempo de espera de voz.");
		else if (["error", "cancelled"].includes(this.view.phase) && now > this.deadline) this.set("idle");
	}
	private async stop() {
		if (this.view.phase !== "listening" || !this.initialized) return;
		const generation = this.generation;
		this.set("transcribing");
		this.deadline = this.host.now() + 120000;
		try {
			const text = (await this.host.stop()).trim();
			if (generation !== this.generation) return;
			this.ownsCapture = false;
			if (!text) {
				this.fail("No reconocí texto. Inténtalo de nuevo.");
				return;
			}
			const state = this.state;
			const conversation = this.conversation;
			if (!this.available() || !state || !conversation || conversation !== state.conversationId) {
				this.fail("El asistente está ocupado o cambió la conversación.");
				return;
			}
			this.before = new Set(state.messages.map((m) => m.id));
			this.requestId = this.host.id();
			this.submitted = true;
			this.submittedText = text;
			this.set("processing");
			this.deadline = this.host.now() + (this.config?.responseTimeoutMs ?? 180000);
			this.host.send({
				type: "send",
				text,
				requestId: this.requestId,
				voiceConversation: conversation,
			});
		} catch (error) {
			if (generation === this.generation) this.fail(String(error));
		}
	}
	update(state: DotState) {
		this.state = state;
		if (!["listening", "transcribing", "processing", "speaking"].includes(this.view.phase)) return;
		if (
			state.connection !== "open" ||
			state.agentState === "restarting" ||
			state.agentState === "error" ||
			state.conversationId !== this.conversation
		) {
			this.fail("Se perdió la sesión del asistente.");
			return;
		}
		if (this.host.muted() && this.view.phase === "speaking") {
			this.cancel();
			return;
		}
		const unavailable = state.voiceReplies.find(
			(r) =>
				r.type === "voice_unavailable" && (r.requestId === this.requestId || r.requestId === this.speechId),
		);
		if (unavailable?.type === "voice_unavailable") {
			this.fail(unavailable.reason);
			return;
		}
		if (this.view.phase === "processing" && this.submitted) {
			if (state.asks.length || state.agentState === "needs_you") {
				this.submitted = false;
				this.speak("Hay una solicitud pendiente. Abre el panel de Gentle Dot para responder.");
				return;
			}
			const added = state.messages.filter((m) => !this.before.has(m.id));
			const users = added.filter((m) => m.role === "user");
			if (users.length > 1 || (users.length === 1 && users.at(0)?.text !== this.submittedText)) {
				this.fail("Otra intervención cambió el turno. Consulta el panel.");
				return;
			}
			const replies = added.filter((m) => m.role === "assistant");
			if (
				state.agentState === "idle" &&
				added.some((m) => m.role === "user") &&
				replies.length &&
				replies.every((m) => !m.streaming)
			) {
				this.submitted = false;
				if (replies.some((m) => m.note)) {
					this.fail("La respuesta no terminó correctamente. Consulta el panel.");
					return;
				}
				this.speak(replies.map((m) => m.text).join("\n\n"));
			}
		}
		const reply = state.voiceReplies.find((r) => r.requestId === this.speechId && r.type === "voice_speech");
		if (reply?.type === "voice_speech") {
			this.speechId = undefined;
			if (reply.mime !== "audio/wav") {
				this.fail("Piper no devolvió audio WAV.");
				return;
			}
			const generation = this.generation;
			this.deadline = this.host.now() + 600000;
			void this.host.play(reply.data).then(
				() => {
					if (generation === this.generation) this.nextChunk();
				},
				(error) => {
					if (generation === this.generation) this.fail(String(error));
				},
			);
		}
	}
	private speak(text: string) {
		if (!this.config?.spokenReplies || this.host.muted()) {
			this.set("idle");
			return;
		}
		// Sequential bounded requests preserve the complete final answer, never truncating it.
		let rest = speakableText(text);
		this.chunks = [];
		while (rest.length) {
			let end = Math.min(MAX_VOICE_TEXT, rest.length);
			if (end < rest.length) {
				const space = rest.lastIndexOf(" ", end);
				if (space > end / 2) end = space;
			}
			this.chunks.push(rest.slice(0, end));
			rest = rest.slice(end).trimStart();
		}
		this.set("speaking");
		this.nextChunk();
	}
	private nextChunk() {
		if (this.host.muted()) {
			this.cancel();
			return;
		}
		const text = this.chunks.shift();
		if (!text) {
			this.set("idle");
			return;
		}
		this.speechId = this.host.id();
		this.deadline = this.host.now() + 150000;
		this.host.send({ type: "voice_speak", requestId: this.speechId, text, localWav: true });
	}
	cancel() {
		++this.generation;
		if (this.speechId && this.state?.connection === "open")
			this.host.send({ type: "voice_speech_cancel", requestId: this.speechId });
		if (this.ownsCapture) void this.host.cancel().catch(() => {});
		this.ownsCapture = false;
		void this.host.stopPlaying().catch(() => {});
		this.requestId = undefined;
		this.speechId = undefined;
		this.chunks = [];
		this.submitted = false;
		this.set("cancelled");
		this.deadline = this.host.now() + 1200;
	}
	fail(note: string) {
		this.cancel();
		this.set("error", note);
		this.deadline = this.host.now() + 4000;
	}
}
