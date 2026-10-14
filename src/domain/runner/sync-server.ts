import { UsageError } from "../../base/errors.js";
import { isObject } from "../../base/objects.js";
import { Result, err, ok } from "../../base/result.js";
import { RojoVersion } from "./rojo-version.js";

export interface ServerInfo {
	readonly server: SyncServer;
	readonly project: string;
	readonly version: string;
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
	/** The first release that reads `syncRules`. */
	readonly syncRulesSince: string;
	/** The release Rogen pins for a project that has none. */
	readonly pinned: string;
	readonly defaultHost: string;
	readonly defaultPort: number;
	readonly infoPath: string;
	readonly hostFlags: readonly string[];
	readonly portFlags: readonly string[];
	/** A line that starts one of its log records, with the groups `level` and `text`. */
	readonly logRecord: RegExp;
	readonly noise: readonly RegExp[];
	/** How it tells that a Studio plugin connected, when it does: the first version to log it, the log records that say so, and the filter that makes it print them. */
	readonly connections?: {
		readonly since: readonly [major: number, minor: number];
		readonly opened: RegExp;
		readonly closed: RegExp;
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

/** A program that serves a project file to its Studio plugin. */
export class SyncServer {
	static readonly ROJO = new SyncServer({
		id: "rojo",
		name: "Rojo",
		repository: "rojo-rbx/rojo",
		syncRulesSince: "7.5.0",
		pinned: "7.7.1",
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
	readonly syncRulesSince: RojoVersion;
	readonly pinned: RojoVersion;
	readonly defaultHost: string;
	readonly defaultPort: number;
	readonly infoPath: string;

	private constructor(private readonly fields: SyncServerFields) {
		this.id = fields.id;
		this.name = fields.name;
		this.repository = fields.repository;
		this.syncRulesSince = RojoVersion.of(fields.syncRulesSince);
		this.pinned = RojoVersion.of(fields.pinned);
		this.defaultHost = fields.defaultHost;
		this.defaultPort = fields.defaultPort;
		this.infoPath = fields.infoPath;
	}

	static byId(id: string): SyncServer | undefined {
		return id === SyncServer.ROJO.id ? SyncServer.ROJO : undefined;
	}

	reportsConnections(version: string): boolean {
		const since = this.fields.connections?.since;
		const found = RojoVersion.parse(version);
		return (
			since !== undefined &&
			found !== undefined &&
			!found.isBefore(RojoVersion.of(`${since[0]}.${since[1]}.0`))
		);
	}

	connectionIn(text: string): "opened" | "closed" | undefined {
		const { connections } = this.fields;
		if (connections?.opened.test(text)) return "opened";
		if (connections?.closed.test(text)) return "closed";
		return undefined;
	}

	get env(): Readonly<
		Record<string, (inherited: string | undefined) => string>
	> {
		return this.fields.connections?.logEnv ?? {};
	}

	get pluginCommand(): string {
		return `${this.id} plugin install`;
	}

	logRecordOf(
		line: string
	): { readonly level: string; readonly text: string } | undefined {
		const groups = this.fields.logRecord.exec(line)?.groups;
		return groups && { level: groups.level, text: groups.text };
	}

	tidied(text: string): string | undefined {
		const tidy = text.trim();
		return this.fields.noise.some((noise) => noise.test(tidy))
			? undefined
			: tidy;
	}

	readInfo(value: unknown): ServerInfo | undefined {
		return isObject(value) ? this.fields.readInfo(this, value) : undefined;
	}

	hostIn(serverArgs: readonly string[]): string | undefined {
		return flagValue(serverArgs, this.fields.hostFlags);
	}

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
