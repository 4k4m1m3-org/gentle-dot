import { chmod, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { piperSpeak } from "../src/piper-local.ts";
import { VoiceService } from "../src/voice.ts";

// Real child processes and WAV files, with a tiny fixture replacing the user's Piper binary.
it("returns WAV without ffmpeg, treats assistant text as stdin, and cleans up", async () => {
	const dir = await mkdtemp(join(tmpdir(), "piper-fixture-"));
	try {
		const bin = join(dir, "piper"),
			model = join(dir, "model.onnx");
		await writeFile(model, "fixture");
		await writeFile(`${model}.json`, "{}");
		await writeFile(
			bin,
			`#!/usr/bin/env node\nconst fs = require('node:fs');let text='';process.stdin.on('data', c => text += c);process.stdin.on('end', () => { const wav=Buffer.alloc(48);wav.write('RIFF');wav.write('WAVE',8);fs.writeFileSync(process.argv.at(-1),wav);fs.writeFileSync(${JSON.stringify(join(dir, "input"))},text); });`,
		);
		await chmod(bin, 0o700);
		const voice = new VoiceService({ apiKey: async () => undefined, piper: { bin, model } });
		const result = await voice.speak("hola $(touch /tmp/do-not-execute-gentle-dot)", true);
		expect(result.ok && result.mime).toBe("audio/wav");
		expect(result.ok && Buffer.from(result.data, "base64").subarray(0, 4).toString()).toBe("RIFF");
		expect(await readdir(dir)).toContain("input");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
it("aborts a running Piper process and rejects without waiting for its timeout", async () => {
	const dir = await mkdtemp(join(tmpdir(), "piper-abort-fixture-"));
	try {
		const bin = join(dir, "piper");
		await writeFile(bin, "#!/usr/bin/env node\nsetInterval(()=>{},1000);process.stdin.resume();");
		await chmod(bin, 0o700);
		const abort = new AbortController();
		const promise = piperSpeak("hello", { bin, model: join(dir, "model") }, true, abort.signal);
		const assertion = expect(promise).rejects.toThrow();
		setTimeout(() => abort.abort(), 100);
		await assertion;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
describe("local-only synthesis", () => {
	it("never falls back to an API even when a key exists", async () => {
		const voice = new VoiceService({
			apiKey: async () => "unused",
			fetch: async () => {
				throw new Error("must not fetch");
			},
		});
		expect(await voice.speak("Hola", true)).toMatchObject({
			ok: false,
			reason: expect.stringContaining("Piper"),
		});
	});
});
