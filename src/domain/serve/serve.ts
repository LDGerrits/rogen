import { UsageError } from "../../base/errors.js";
import { isObject } from "../../base/objects.js";
import { Result, err, ok } from "../../base/result.js";

/** What a running sync server says it serves. */
export interface ServerInfo {
	readonly server: SyncServer;
	/** The name of the project file it serves. */
	readonly project: string;
	readonly version: string;
	/** Rojo's id for this run of the server. */
	readonly session?: string;
}

/** One thing a server said. `info` is a line Rogen doesn't recognise, kept so nothing that explains a failure is lost; `debug` is what Rogen drops as noise, shown only with `--verbose`. */
export interface ServerMessage {
	readonly severity: "error" | "warning" | "info" | "debug";
	readonly text: string;
}

interface SyncServerFields {
	readonly id: string;
	readonly name: string;
	/** Where toolchain managers install it from, as `owner/repo`. */
	readonly repository: string;
	readonly defaultHost: string;
	readonly defaultPort: number;
	/** The path that answers what it serves. */
	readonly infoPath: string;
	readonly hostFlags: readonly string[];
	readonly portFlags: readonly string[];
	/** A line that starts one of its log records, with the groups `level` and `text`. */
	readonly logRecord: RegExp;
	/** What it prints that tells a Rogen user nothing: its banner, and what Rogen's own probes and writes make it say. */
	readonly noise: readonly RegExp[];
	/** How it tells that a Studio plugin connected, when it does: the first version to log it, the log records that say so, and the filter that makes it print them. */
	readonly connections?: {
		readonly since: readonly [major: number, minor: number];
		readonly opened: RegExp;
		readonly closed: RegExp;
		/** The variables that make it print them, each from what the user already set, so a filter of the user's stays. */
		readonly logEnv: Readonly<
			Record<string, (inherited: string | undefined) => string>
		>;
	};
	readonly readInfo: (
		server: SyncServer,
		value: Readonly<Record<string, unknown>>
	) => ServerInfo | undefined;
}

const text = (value: unknown): string | undefined =>
	typeof value === "string" ? value : undefined;

/** A program that serves a project file to its Studio plugin. Rogen starts the one a project pins, and never bundles one: it has to match the plugin the user installed. */
export class SyncServer {
	static readonly ROJO = new SyncServer({
		id: "rojo",
		name: "Rojo",
		repository: "rojo-rbx/rojo",
		defaultHost: "127.0.0.1",
		defaultPort: 34872,
		infoPath: "/api/rojo",
		hostFlags: ["--address"],
		portFlags: ["--port"],
		logRecord: /^\[(?<level>[A-Z]+)\s*[^\]]*\]\s?(?<text>.*)$/,
		noise: [/^Rojo server listening:$/, /^(Address|Port):/, /^Visit http/],
		// Its plugin holds one websocket to the server, which logs it at debug level.
		connections: {
			since: [7, 7],
			opened: /^WebSocket subscription established\b/,
			// Each way its handler can end a connection logs one of these.
			closed: /^(WebSocket subscription closed|WebSocket stream ended|WebSocket error|Message queue disconnected)\b/,
			logEnv: {
				RUST_LOG: (inherited) =>
					`${inherited ?? "info"},librojo::web=debug`,
			},
		},
		readInfo: (server, value) => {
			const project = text(value.projectName);
			const version = text(value.serverVersion);
			return project === undefined || version === undefined
				? undefined
				: {
						server,
						project,
						version,
						session: text(value.sessionId),
					};
		},
	});

	readonly id: string;
	readonly name: string;
	readonly repository: string;
	readonly defaultHost: string;
	readonly defaultPort: number;
	readonly infoPath: string;

	private constructor(private readonly fields: SyncServerFields) {
		this.id = fields.id;
		this.name = fields.name;
		this.repository = fields.repository;
		this.defaultHost = fields.defaultHost;
		this.defaultPort = fields.defaultPort;
		this.infoPath = fields.infoPath;
	}

	static byId(id: string): SyncServer | undefined {
		return id === SyncServer.ROJO.id ? SyncServer.ROJO : undefined;
	}

	/** Whether this version of it says in its output when a Studio plugin connects or leaves. */
	reportsConnections(version: string): boolean {
		const since = this.fields.connections?.since;
		const found = /^(\d+)\.(\d+)/.exec(version);
		if (!since || !found) return false;
		const [major, minor] = [Number(found[1]), Number(found[2])];
		return major > since[0] || (major === since[0] && minor >= since[1]);
	}

	/** Whether `text`, the text of one of its log records, says a Studio plugin connected or left. */
	connectionIn(text: string): "opened" | "closed" | undefined {
		const { connections } = this.fields;
		if (connections?.opened.test(text)) return "opened";
		if (connections?.closed.test(text)) return "closed";
		return undefined;
	}

	/** The environment variables that make it print the records `connectionIn` reads, each from what the environment already holds. */
	get env(): Readonly<
		Record<string, (inherited: string | undefined) => string>
	> {
		return this.fields.connections?.logEnv ?? {};
	}

	/** The command that installs its Studio plugin. */
	get pluginCommand(): string {
		return `${this.id} plugin install`;
	}

	/** The line that starts it on `projectFile`; `serverArgs` go last, untouched. */
	serveArgs(projectFile: string, serverArgs: readonly string[]): string[] {
		return ["serve", projectFile, ...serverArgs];
	}

	/** The level and text of `line` when it starts one of its log records. */
	logRecordOf(
		line: string
	): { readonly level: string; readonly text: string } | undefined {
		const groups = this.fields.logRecord.exec(line)?.groups;
		return groups && { level: groups.level, text: groups.text };
	}

	/** `text` trimmed; `undefined` when it is noise. */
	tidied(text: string): string | undefined {
		const tidy = text.trim();
		return this.fields.noise.some((noise) => noise.test(tidy))
			? undefined
			: tidy;
	}

	/** What an answer from `infoPath` says, when it is this server's answer. */
	readInfo(value: unknown): ServerInfo | undefined {
		return isObject(value) ? this.fields.readInfo(this, value) : undefined;
	}

	/** The value `serverArgs` give the host flag, if any. */
	hostIn(serverArgs: readonly string[]): string | undefined {
		return flagValue(serverArgs, this.fields.hostFlags);
	}

	/** The port `serverArgs` give, if any: `undefined` when none; an error when the value isn't a port. */
	portIn(
		serverArgs: readonly string[]
	): Result<number | undefined, UsageError> {
		const value = flagValue(serverArgs, this.fields.portFlags);
		if (value === undefined) return ok(undefined);
		const port = /^\d+$/.test(value) ? Number(value) : NaN;
		return port > 0 && port < 65536
			? ok(port)
			: err(
					new UsageError(
						"The --port after '--' takes a number from 1 to 65535."
					)
				);
	}
}

/** The value of the last of `flags` in `args`, written `--flag value` or `--flag=value`. */
function flagValue(
	args: readonly string[],
	flags: readonly string[]
): string | undefined {
	let value: string | undefined;
	args.forEach((arg, index) => {
		for (const flag of flags) {
			if (arg === flag) value = args[index + 1];
			else if (arg.startsWith(`${flag}=`))
				value = arg.slice(flag.length + 1);
		}
	});
	return value;
}

/** Where a server listens. */
export class ServeAddress {
	constructor(
		readonly host: string,
		readonly port: number
	) {}

	/** The hosts to reach it at: a server listening on every interface or on `localhost` answers on loopback. */
	get loopbackHosts(): string[] {
		switch (this.host) {
			case "0.0.0.0":
				return ["127.0.0.1"];
			case "::":
			case "[::]":
				return ["::1", "127.0.0.1"];
			case "localhost":
				return ["127.0.0.1", "::1"];
			default:
				return [this.host.replace(/^\[(.*)\]$/, "$1")];
		}
	}

	/** Whether it listens on this machine's loopback, where a free port can be looked for. */
	get isLocal(): boolean {
		return [
			"127.0.0.1",
			"localhost",
			"0.0.0.0",
			"::",
			"[::]",
			"::1",
		].includes(this.host);
	}

	/** `path` on this address, reached at `host`. */
	urlAt(host: string, path: string): string {
		return `http://${host.includes(":") ? `[${host}]` : host}:${this.port}${path}`;
	}

	toString(): string {
		return `${this.host}:${this.port}`;
	}
}
