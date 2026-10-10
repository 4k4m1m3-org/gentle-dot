import { describe, expect, it, vi } from "vitest";
import { BackgroundVoice, type VoiceModeConfig } from "../src/background-voice.ts";
import { type DotState, initialState } from "../src/store.ts";

const config: VoiceModeConfig = {
	enabled: true,
	spokenReplies: true,
	silenceMs: 1500,
	maxCaptureMs: 30000,
	initialWaitMs: 10000,
	levelThreshold: 0.32,
	responseTimeoutMs: 180000,
};
function setup() {
	let time = 0,
		id = 0;
	const host = {
		start: vi.fn(async () => {}),
		stop: vi.fn(async () => "Hola"),
		cancel: vi.fn(async () => {}),
		play: vi.fn(async () => {}),
		stopPlaying: vi.fn(async () => {}),
		send: vi.fn(),
		muted: vi.fn(() => false),
		now: () => time,
		id: () => `r${++id}`,
		changed: vi.fn(),
	};
	const voice = new BackgroundVoice(host);
	const state: DotState = {
		...initialState,
		connection: "open",
		agentState: "idle",
		conversationId: "normal",
	};
	voice.update(state);
	return {
		voice,
		host,
		state,
		advance: (ms: number) => {
			time += ms;
			voice.tick();
		},
	};
}
const flush = async () => {
	await Promise.resolve();
	await Promise.resolve();
};
describe("background voice", () => {
	it("waits for initialization, then silence sends exactly once in the normal conversation", async () => {
		const { voice, host, advance } = setup();
		let ready!: () => void;
		host.start.mockImplementation(
			() =>
				new Promise((resolve) => {
					ready = resolve;
				}),
		);
		const starting = voice.toggle(config);
		advance(30000);
		expect(host.stop).not.toHaveBeenCalled();
		ready();
		await starting;
		voice.level(0.6);
		advance(1499);
		expect(host.stop).not.toHaveBeenCalled();
		advance(1);
		advance(100);
		await flush();
		expect(host.send).toHaveBeenCalledExactlyOnceWith({
			type: "send",
			text: "Hola",
			requestId: "r1",
			voiceConversation: "normal",
		});
	});
	it("a repeated shortcut stops once; an empty transcript is never sent", async () => {
		const { voice, host } = setup();
		host.stop.mockResolvedValue("");
		await voice.toggle(config);
		await voice.toggle(config);
		expect(host.stop).toHaveBeenCalledTimes(1);
		expect(host.send).not.toHaveBeenCalled();
		expect(voice.view.phase).toBe("error");
	});
	it("cancel fences a late transcript", async () => {
		const { voice, host } = setup();
		let done!: (s: string) => void;
		host.stop.mockImplementation(
			() =>
				new Promise((resolve) => {
					done = resolve;
				}),
		);
		await voice.toggle(config);
		const stopping = voice.toggle(config);
		voice.cancel();
		done("Do not send");
		await stopping;
		expect(host.send).not.toHaveBeenCalled();
		expect(voice.view.phase).toBe("cancelled");
	});
	it("times out no speech and bounds a continuous recording", async () => {
		const a = setup();
		await a.voice.toggle(config);
		a.advance(10000);
		expect(a.host.cancel).toHaveBeenCalled();
		expect(a.host.send).not.toHaveBeenCalled();
		const b = setup();
		await b.voice.toggle(config);
		b.voice.level(0.5);
		b.advance(30000);
		await flush();
		expect(b.host.stop).toHaveBeenCalledTimes(1);
	});
	it("refuses busy/disabled starts and disconnects return to idle after an error", async () => {
		const { voice, host, state, advance } = setup();
		voice.update({ ...state, agentState: "working" });
		await voice.toggle(config);
		expect(host.start).not.toHaveBeenCalled();
		voice.update(state);
		await voice.toggle({ ...config, enabled: false });
		expect(host.start).not.toHaveBeenCalled();
		await voice.toggle(config);
		voice.update({ ...state, connection: "closed" });
		expect(host.cancel).toHaveBeenCalled();
		advance(4001);
		expect(voice.view.phase).toBe("idle");
	});
	it("plays only the complete final answer once, without panel playback", async () => {
		const { voice, host, state } = setup();
		await voice.toggle(config);
		await voice.toggle(config);
		const assistantMessage = {
			id: "a",
			role: "assistant" as const,
			text: "Respuesta",
			streaming: true,
			activities: [],
		};
		const messages = [
			{ id: "u", role: "user" as const, text: "Hola", streaming: false, activities: [] },
			assistantMessage,
		];
		voice.update({ ...state, agentState: "thinking", messages });
		expect(host.send).toHaveBeenCalledTimes(1);
		assistantMessage.streaming = false;
		voice.update({ ...state, messages });
		voice.update({ ...state, messages });
		expect(host.send).toHaveBeenCalledTimes(2);
		expect(host.send).toHaveBeenLastCalledWith({
			type: "voice_speak",
			text: "Respuesta",
			requestId: "r2",
			localWav: true,
		});
		const answered = {
			...state,
			messages,
			voiceReplies: [
				{ type: "voice_speech" as const, requestId: "r2", mime: "audio/wav", data: "WAV", seq: 1 },
			],
		};
		voice.update(answered);
		voice.update(answered);
		await flush();
		expect(host.play).toHaveBeenCalledExactlyOnceWith("WAV");
		expect(voice.view.phase).toBe("idle");
	});
	it("announces an approval without answering it, and honors mute", async () => {
		const { voice, host, state } = setup();
		await voice.toggle(config);
		await voice.toggle(config);
		voice.update({ ...state, agentState: "needs_you" });
		expect(host.send.mock.calls.at(-1)?.[0].type).toBe("voice_speak");
		expect(host.send.mock.calls.some(([m]) => m.type === "ui_response")).toBe(false);
		host.muted.mockReturnValue(true);
		voice.update(state);
		expect(voice.view.phase).toBe("cancelled");
	});
	it("cancels a pending response on timeout or conversation change", async () => {
		const { voice, host, state, advance } = setup();
		await voice.toggle(config);
		await voice.toggle(config);
		advance(180001);
		expect(voice.view.phase).toBe("error");
		expect(host.send).toHaveBeenCalledTimes(1);
		await voice.toggle(config);
		voice.update({ ...state, conversationId: "other" });
		expect(voice.view.phase).toBe("error");
	});
});
