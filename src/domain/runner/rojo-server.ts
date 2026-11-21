import { isObject } from "../../base/objects.js";
import { LogLevel } from "../../platform/log/log-service.js";
import { RojoVersion } from "./rojo-version.js";

export interface ServerMessage {
	readonly severity: "error" | "warning" | "unrecognised" | "noise";
	readonly text: string;
	readonly details?: readonly string[];
	readonly stdout?: string;
}

export interface ServerInfo {
	readonly project: string;
	readonly version: string;
	readonly session?: string;
}

const CONNECTIONS_SINCE = RojoVersion.of("7.7.0");

const LOG_RECORD = /^\[(?<level>[A-Z]+)\s*[^\]]*\]\s?(?<text>.*)$/;

const NOISE = [/^Rojo server listening:$/, /^(Address|Port):/, /^Visit http/];

const CONNECTION_OPENED = /^WebSocket subscription established\b/;

const CONNECTION_CLOSED =
	/^(WebSocket subscription closed|WebSocket stream ended|WebSocket error|Message queue disconnected)\b/;

const BUILT = [/^Built project to .+$/, /^Created sourcemap at .+$/];

const PROGRESS = [
	/^Building project '.*'$/,
	...BUILT,
	/^Beginning syncback\.\.\.$/,
	/^Writing to the file system\.\.\.$/,
	/^Finished syncback\.$/,
	/^Would write \d+ files\/folders and remove \d+ files\/folders\.$/,
	/^Aborting before writing to file system due to `--dry-run`$/,
];

const CRASHED = /^Rojo crashed!/;

const text = (value: unknown): string | undefined =>
	typeof value === "string" ? value : undefined;

export class RojoServer {
	static readonly COMMAND = "rojo";

	static readonly REPOSITORY = "rojo-rbx/rojo";

	static readonly PINNED = RojoVersion.of("7.7.1");

	static readonly DEFAULT_HOST = "127.0.0.1";

	static readonly DEFAULT_PORT = 34872;

	static readonly INFO_PATH = "/api/rojo";

	static readonly PLUGIN_COMMAND = "rogen plugin install";

	/**
	 * The environment that makes it print its connection records, and what its
	 * `-v` or `-vv` would show at `level` unless the user set a filter.
	 */
	static logEnv(
		level: LogLevel
	): Readonly<Record<string, (inherited: string | undefined) => string>> {
		return {
			RUST_LOG: (inherited) => {
				if (inherited !== undefined)
					return `${inherited},librojo::web=debug`;
				if (level >= LogLevel.Trace) return "info,librojo=trace";
				if (level >= LogLevel.Debug) return "info,librojo=debug";
				return "info,librojo::web=debug";
			},
		};
	}

	static readInfo(value: unknown): ServerInfo | undefined {
		if (!isObject(value)) return undefined;
		const project = text(value.projectName);
		const version = text(value.serverVersion);
		return project === undefined || version === undefined
			? undefined
			: { project, version, session: text(value.sessionId) };
	}

	static reportsConnections(version: string): boolean {
		const found = RojoVersion.parse(version);
		return found !== undefined && !found.isBefore(CONNECTIONS_SINCE);
	}

	static connectionIn(line: string): "opened" | "closed" | undefined {
		if (CONNECTION_OPENED.test(line)) return "opened";
		if (CONNECTION_CLOSED.test(line)) return "closed";
		return undefined;
	}

	static isProgress(text: string): boolean {
		return PROGRESS.some((line) => line.test(text));
	}

	static endsBuild(text: string): boolean {
		return text.startsWith("{") || BUILT.some((line) => line.test(text));
	}

	static isCrash(text: string): boolean {
		return CRASHED.test(text);
	}

	static logRecordOf(
		line: string
	): { readonly level: string; readonly text: string } | undefined {
		const groups = LOG_RECORD.exec(line)?.groups;
		return groups && { level: groups.level, text: groups.text };
	}

	static tidied(line: string): string | undefined {
		const tidy = line.trim();
		return NOISE.some((noise) => noise.test(tidy)) ? undefined : tidy;
	}
}
