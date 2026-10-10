/** Piper CLI local: sintetiza texto en WAV, lo comprime a MP3 y devuelve base64. */
import { execFile, spawn } from "node:child_process";
import { constants, readFileSync } from "node:fs";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

export interface PiperConfig {
	bin: string;
	model: string;
}

/** Solo lee el archivo del usuario. No modifica conectores ni credenciales. */
export function loadPiperConfig(dataDir: string): PiperConfig | undefined {
	try {
		const value: unknown = JSON.parse(readFileSync(join(dataDir, "piper.json"), "utf8"));
		if (!value || typeof value !== "object") return undefined;
		const config = value as Record<string, unknown>;
		if (typeof config.bin !== "string" || typeof config.model !== "string") return undefined;
		if (!isAbsolute(config.bin) || !isAbsolute(config.model)) return undefined;
		return { bin: config.bin, model: config.model };
	} catch {
		return undefined;
	}
}

export async function piperAvailable(config: PiperConfig): Promise<boolean> {
	try {
		await Promise.all([
			access(config.bin, constants.X_OK),
			access(config.model, constants.R_OK),
			access(`${config.model}.json`, constants.R_OK),
		]);
		return true;
	} catch {
		return false;
	}
}

const exec = promisify(execFile);

/** Invoca el Piper existente sin shell, con entrada por stdin y salida privada temporal. */
async function produceWav(
	text: string,
	config: PiperConfig,
	wav: string,
	signal?: AbortSignal,
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(config.bin, ["--model", config.model, "--output_file", wav], {
			stdio: ["pipe", "ignore", "ignore"],
			timeout: 120_000,
			killSignal: "SIGKILL",
			...(signal ? { signal } : {}),
		});
		let settled = false;
		function done(error?: Error) {
			if (settled) return;
			settled = true;
			if (error) reject(error);
			else resolve();
		}
		let failure: Error | undefined;
		child.once("error", () => {
			failure = new Error("No se pudo ejecutar Piper o se canceló la síntesis");
		});
		// Wait for process closure before removing its output directory (also on abort).
		child.once("close", (code) =>
			done(failure ?? (code === 0 ? undefined : new Error("Falló la síntesis de Piper"))),
		);
		child.stdin.on("error", () => {});
		child.stdin.end(`${text}\n`);
	});
}

/** El MP3 limita el tamaño enviado al panel WebKitGTK frente a un WAV sin comprimir. */
export async function piperSpeak(
	text: string,
	config: PiperConfig,
	wavOnly = false,
	signal?: AbortSignal,
): Promise<{ ok: true; mime: string; data: string }> {
	const workDir = await mkdtemp(join(tmpdir(), "gentle-dot-piper-"));
	const wav = join(workDir, "answer.wav");
	const mp3 = join(workDir, "answer.mp3");
	try {
		await produceWav(text, config, wav, signal);
		const check = await readFile(wav);
		if (check.length < 44 || check.toString("ascii", 0, 4) !== "RIFF") {
			throw new Error("Piper no generó un WAV válido");
		}
		if (wavOnly) return { ok: true, mime: "audio/wav", data: check.toString("base64") };
		await exec(
			"ffmpeg",
			["-nostdin", "-y", "-loglevel", "error", "-i", wav, "-codec:a", "libmp3lame", "-q:a", "5", mp3],
			{ timeout: 60_000 },
		);
		const audio = await readFile(mp3);
		if (audio.length === 0) throw new Error("MP3 vacío");
		return { ok: true, mime: "audio/mpeg", data: audio.toString("base64") };
	} finally {
		await rm(workDir, { recursive: true, force: true });
	}
}
