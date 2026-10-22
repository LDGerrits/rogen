import { stripVTControlCharacters } from "util";
import { RunOnceScheduler } from "../../base/async.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { Emitter, Event } from "../../base/event.js";
import { RojoServer, ServerMessage } from "./rojo-server.js";

const RECORD_QUIET_MS = 50;

const REPEAT_MS = 2_000;

const SEVERITIES: Readonly<Record<string, ServerMessage["severity"]>> = {
	ERROR: "error",
	WARN: "warning",
	WARNING: "warning",
	INFO: "debug",
	DEBUG: "debug",
	TRACE: "debug",
};

/** Rust's own lines: a CLI error or warning; in capitals, a message the server wrote itself, as a paragraph that ends at the blank line. */
const RUST_RECORD = /^(?<level>error|warning|ERROR|WARNING): (?<text>.*)$/;
const RUST_NOISE = /^note: run with `RUST_BACKTRACE=1`/;

interface PendingRecord {
	readonly severity: ServerMessage["severity"];
	readonly parts: string[];
	readonly paragraph: boolean;
}

/** Reads what a server prints into messages; its banner, info logs and the noise Rogen causes come as `debug`. */
export class ServerOutput extends AbstractDisposable {
	private readonly _onDidMessage = this._register(
		new Emitter<ServerMessage>()
	);
	readonly onDidMessage: Event<ServerMessage> = this._onDidMessage.event;

	private readonly _onDidConnection = this._register(
		new Emitter<"opened" | "closed">()
	);
	readonly onDidConnection: Event<"opened" | "closed"> =
		this._onDidConnection.event;

	private pending: PendingRecord | undefined;
	private readonly quiet: RunOnceScheduler;
	private last: { readonly key: string; readonly at: number } | undefined;
	private inBanner = false;

	constructor() {
		super();
		this.quiet = this._register(
			new RunOnceScheduler(() => this.flush(), RECORD_QUIET_MS)
		);
	}

	/** `stream` is the one `line` came on, when known. */
	readLine(line: string, stream?: "stdout" | "stderr"): void {
		this.read(stripVTControlCharacters(line), stream);
		this.quiet.cancel();
		if (this.pending) this.quiet.schedule();
	}

	end(): void {
		this.flush();
	}

	private read(line: string, stream?: "stdout" | "stderr"): void {
		const logged = RojoServer.logRecordOf(line);
		if (stream === "stdout" && !logged) {
			this.flush();
			this.say("info", line.trim(), false, line);
			return;
		}
		const record = logged ?? RUST_RECORD.exec(line)?.groups;
		if (record) {
			this.flush();
			const level = record.level.toUpperCase();
			this.pending = {
				severity: level in SEVERITIES ? SEVERITIES[level] : "info",
				parts: [record.text],
				paragraph: logged === undefined && record.level === level,
			};
			return;
		}
		if (this.pending?.paragraph) {
			if (line.trim() === "") this.flush();
			else this.pending.parts.push(line.trim());
			return;
		}
		// A record's cause chain follows it, indented.
		if (this.pending && (line.trim() === "" || /^\s/.test(line))) {
			this.pending.parts.push(line.trim());
			return;
		}
		this.flush();
		this.say("info", line.trim(), false);
	}

	private flush(): void {
		this.quiet.cancel();
		const record = this.pending;
		this.pending = undefined;
		if (!record) return;
		this.say(
			record.severity,
			record.paragraph
				? record.parts.filter((part) => part !== "").join(" ")
				: record.parts
						.filter((part) => part !== "" && part !== "Caused by:")
						.map((part) => part.replace(/^\d+:\s*/, ""))
						.join(": "),
			!record.paragraph
		);
	}

	private say(
		severity: ServerMessage["severity"],
		said: string,
		isLogRecord = true,
		stdout?: string
	): void {
		const text = RUST_NOISE.test(said)
			? undefined
			: RojoServer.tidied(said);
		if (stdout !== undefined) {
			const banner = RojoServer.tidied(said) === undefined;
			if (banner || (this.inBanner && said === "")) {
				this.inBanner = true;
				this._onDidMessage.fire({ severity: "debug", text: said });
				return;
			}
			this.inBanner = false;
			this._onDidMessage.fire({
				severity: text && severity !== "debug" ? severity : "debug",
				text: text ?? said,
				stdout,
			});
			return;
		}
		if (said === "") return;
		const change = isLogRecord ? RojoServer.connectionIn(said) : undefined;
		if (change) this._onDidConnection.fire(change);
		if (severity === "debug" || !text) {
			this._onDidMessage.fire({ severity: "debug", text: said });
			return;
		}
		const key = `${severity} ${text}`;
		const now = Date.now();
		if (this.last?.key === key && now - this.last.at < REPEAT_MS) return;
		this.last = { key, at: now };
		this._onDidMessage.fire({ severity, text });
	}
}
