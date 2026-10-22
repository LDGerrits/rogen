import { isObject } from "../../base/objects.js";
import { RojoVersion } from "./rojo-version.js";

/** One thing the server said. `info` is a line Rogen doesn't recognise, kept so nothing that explains a failure is lost; `debug` is what Rogen drops as noise, shown only with `--verbose`. */
export interface ServerMessage {
	readonly severity: "error" | "warning" | "info" | "debug";
	readonly text: string;
	/** The line as the server printed it on stdout, when it is one a program reading stdout takes in: not a log record. */
	readonly stdout?: string;
}

export interface ServerInfo {
	readonly project: string;
	readonly version: string;
	readonly session?: string;
}

/** The first version that logs a Studio plugin connecting; its plugin holds one websocket to the server, which logs it at debug level. */
const CONNECTIONS_SINCE = RojoVersion.of("7.7.0");

/** A line that starts one of its log records, with the groups `level` and `text`. */
const LOG_RECORD = /^\[(?<level>[A-Z]+)\s*[^\]]*\]\s?(?<text>.*)$/;

const NOISE = [/^Rojo server listening:$/, /^(Address|Port):/, /^Visit http/];

const CONNECTION_OPENED = /^WebSocket subscription established\b/;

// Each way its handler can end a connection logs one of these.
const CONNECTION_CLOSED =
	/^(WebSocket subscription closed|WebSocket stream ended|WebSocket error|Message queue disconnected)\b/;

const text = (value: unknown): string | undefined =>
	typeof value === "string" ? value : undefined;

/** The program `rogen serve` starts to serve a project file to its Studio plugin. */
export class RojoServer {
	/** The executable's name, and what `--json` output calls the server. */
	static readonly COMMAND = "rojo";

	/** Where toolchain managers install it from, as `owner/repo`. */
	static readonly REPOSITORY = "rojo-rbx/rojo";

	/** The release Rogen pins for a project that has none. */
	static readonly PINNED = RojoVersion.of("7.7.1");

	static readonly DEFAULT_HOST = "127.0.0.1";

	static readonly DEFAULT_PORT = 34872;

	/** The path that answers with the project it serves. */
	static readonly INFO_PATH = "/api/rojo";

	/** What installs its Studio plugin: Rogen runs the pinned Rojo's. */
	static readonly PLUGIN_COMMAND = "rogen plugin install";

	/** The environment that makes it print its connection records. */
	static readonly LOG_ENV: Readonly<
		Record<string, (inherited: string | undefined) => string>
	> = {
		RUST_LOG: (inherited) => `${inherited ?? "info"},librojo::web=debug`,
	};

	/** What its info endpoint answered, when it is Rojo's answer. */
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

	static logRecordOf(
		line: string
	): { readonly level: string; readonly text: string } | undefined {
		const groups = LOG_RECORD.exec(line)?.groups;
		return groups && { level: groups.level, text: groups.text };
	}

	/** `line` trimmed, or nothing when it is a banner line Rogen drops. */
	static tidied(line: string): string | undefined {
		const tidy = line.trim();
		return NOISE.some((noise) => noise.test(tidy)) ? undefined : tidy;
	}
}
