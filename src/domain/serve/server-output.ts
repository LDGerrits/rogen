import { stripVTControlCharacters } from "util";
import { RunOnceScheduler } from "../../base/async.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { Emitter, Event } from "../../base/event.js";
import { ServerMessage, SyncServer } from "./serve.js";

/** How long a record waits for more of its lines before it is passed on. */
const RECORD_QUIET_MS = 50;

/** How long the same message is said only once; servers often log one failure twice. */
const REPEAT_MS = 2_000;

/** What each log level shows as; a level not here shows as `info`. */
const SEVERITIES: Readonly<Record<string, ServerMessage["severity"]>> = {
	ERROR: "error",
	WARN: "warning",
	WARNING: "warning",
	INFO: "debug",
	DEBUG: "debug",
	TRACE: "debug",
};

/** Rust's own lines: a CLI error or warning, and the hint that follows a panic. */
const RUST_RECORD = /^(?<level>error|warning): (?<text>.*)$/;
const RUST_NOISE = /^note: run with `RUST_BACKTRACE=1`/;

interface PendingRecord {
	readonly severity: ServerMessage["severity"];
	readonly parts: string[];
}

/** Reads what a server prints into messages: its warnings and errors, each on one line without its debug detail, and as `debug` its banner, its info logs and the noise Rogen causes. */
export class ServerOutput extends AbstractDisposable {
	private readonly _onDidMessage = this._register(
		new Emitter<ServerMessage>()
	);
	readonly onDidMessage: Event<ServerMessage> = this._onDidMessage.event;

	private partial = "";
	private pending: PendingRecord | undefined;
	private readonly quiet: RunOnceScheduler;
	private last: { readonly key: string; readonly at: number } | undefined;

	constructor(private readonly server: SyncServer) {
		super();
		this.quiet = this._register(
			new RunOnceScheduler(() => this.flush(), RECORD_QUIET_MS)
		);
	}

	write(text: string): void {
		const lines = (this.partial + text).split(/\r?\n/);
		this.partial = lines.pop()!;
		for (const line of lines) this.read(stripVTControlCharacters(line));
		this.quiet.cancel();
		if (this.pending) this.quiet.schedule();
	}

	/** Passes on what is left, once the server has stopped printing. */
	end(): void {
		if (this.partial) this.read(stripVTControlCharacters(this.partial));
		this.partial = "";
		this.flush();
	}

	private read(line: string): void {
		const record =
			this.server.logRecordOf(line) ?? RUST_RECORD.exec(line)?.groups;
		if (record) {
			this.flush();
			const level = record.level.toUpperCase();
			this.pending = {
				severity: level in SEVERITIES ? SEVERITIES[level] : "info",
				parts: [record.text],
			};
			return;
		}
		// A record's cause chain follows it, indented.
		if (this.pending && (line.trim() === "" || /^\s/.test(line))) {
			this.pending.parts.push(line.trim());
			return;
		}
		this.flush();
		this.say("info", line.trim());
	}

	private flush(): void {
		this.quiet.cancel();
		const record = this.pending;
		this.pending = undefined;
		if (!record) return;
		this.say(
			record.severity,
			record.parts
				.filter((part) => part !== "" && part !== "Caused by:")
				.map((part) => part.replace(/^\d+:\s*/, ""))
				.join(": ")
		);
	}

	private say(severity: ServerMessage["severity"], said: string): void {
		if (said === "") return;
		const text = RUST_NOISE.test(said)
			? undefined
			: this.server.tidied(said);
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
