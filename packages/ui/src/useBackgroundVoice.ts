import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { BackgroundVoice, type VoiceModeConfig, type VoiceModeView } from "./background-voice.ts";
import { newRequestId, type Send } from "./components/types.ts";
import type { DotState } from "./store.ts";
import { cancelNativeVoice, onNativeVoice, startNativeVoice, stopNativeVoice } from "./voice-native.ts";

export function useBackgroundVoice(enabled: boolean, state: DotState, send: Send) {
	const [view, setView] = useState<VoiceModeView>({ phase: "idle", level: 0, note: "" });
	const latest = useRef(state);
	latest.current = state;
	const controller = useRef<BackgroundVoice | undefined>(undefined);
	useEffect(() => {
		if (!enabled) return;
		let live = true,
			polling = false,
			subscribed = false;
		const muted = () => {
			try {
				return localStorage.getItem("gentle-dot-voice-muted") === "1";
			} catch {
				return false;
			}
		};
		const voice = new BackgroundVoice({
			start: () => startNativeVoice("es-ES"),
			stop: stopNativeVoice,
			cancel: cancelNativeVoice,
			play: (data) => invoke("voice_play", { data }),
			stopPlaying: () => invoke("voice_play_cancel"),
			now: () => Date.now(),
			id: newRequestId,
			muted,
			send,
			changed: (value) => {
				if (live) setView(value);
				try {
					if (["listening", "transcribing", "processing", "speaking"].includes(value.phase))
						localStorage.setItem("gentle-dot-background-voice-active", "1");
					else localStorage.removeItem("gentle-dot-background-voice-active");
				} catch {
					/* A native owner still protects the microphone. */
				}
			},
		});
		controller.current = voice;
		voice.update(latest.current);
		try {
			localStorage.removeItem("gentle-dot-background-voice-active");
		} catch {
			/* optional storage */
		}
		const off = onNativeVoice({
			partial: () => {},
			level: (value) => voice.level(value),
			error: (note) => voice.fail(note),
		})
			.then((stop) => {
				subscribed = true;
				return stop;
			})
			.catch((error) => {
				if (live) voice.fail(String(error));
				return () => {};
			});
		const timer = setInterval(() => {
			voice.tick();
			if (polling || !subscribed) return;
			polling = true;
			void invoke<{ action: string; config: VoiceModeConfig } | null>("voice_mode_poll", {
				ready: latest.current.connection === "open" && !!latest.current.conversationId,
			})
				.then((result) => {
					if (!live || !result) return;
					if (result.action === "cancel") voice.cancel();
					else void voice.toggle(result.config);
				})
				.catch((error) => {
					if (live) voice.fail(String(error));
				})
				.finally(() => {
					polling = false;
				});
		}, 100);
		const storage = () => voice.update(latest.current);
		window.addEventListener("storage", storage);
		return () => {
			live = false;
			clearInterval(timer);
			voice.cancel();
			controller.current = undefined;
			window.removeEventListener("storage", storage);
			void off.then((stop) => stop());
		};
	}, [enabled, send]);
	useEffect(() => controller.current?.update(state), [state]);
	return view;
}
