import path from "path";
import { isObject } from "../../base/objects.js";
import { ResolvedConfig } from "../config/config.js";

/** What a running sync server says it serves. */
export interface ServerInfo {
	readonly server: SyncServer;
	/** The name of the project file it serves. */
	readonly project: string;
	readonly version: string;
	/** Rojo's id for this run of the server. */
	readonly session?: string;
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
	/** Its own settings files that may set `host` and `port`, the first found winning. */
	readonly settingsFiles: (projectDir: string, userHome: string) => string[];
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
		settingsFiles: () => [],
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

	static readonly ARGON = new SyncServer({
		id: "argon",
		name: "Argon",
		repository: "argon-rbx/argon",
		defaultHost: "localhost",
		defaultPort: 8000,
		infoPath: "/details",
		hostFlags: ["--host", "-H"],
		portFlags: ["--port", "-P"],
		settingsFiles: (projectDir, userHome) => [
			path.join(projectDir, "argon.toml"),
			path.join(userHome, ".argon", "config.toml"),
		],
		readInfo: (server, value) => {
			const project = text(value.name);
			const version = text(value.version);
			return project === undefined || version === undefined
				? undefined
				: { server, project, version };
		},
	});

	/** In the order one is picked when a project has several. */
	static readonly ALL: readonly SyncServer[] = [
		SyncServer.ROJO,
		SyncServer.ARGON,
	];

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
		return SyncServer.ALL.find((server) => server.id === id.toLowerCase());
	}

	/** The command that installs its Studio plugin. */
	get pluginCommand(): string {
		return `${this.id} plugin install`;
	}

	/** The line that starts it on `projectFile`; `serverArgs` go last, untouched. */
	serveArgs(projectFile: string, serverArgs: readonly string[]): string[] {
		return ["serve", projectFile, ...serverArgs];
	}

	/** What an answer from `infoPath` says, when it is this server's answer. */
	readInfo(value: unknown): ServerInfo | undefined {
		return isObject(value) ? this.fields.readInfo(this, value) : undefined;
	}

	/** The settings files that may set where it listens when the project file doesn't: beside the project file, then the user's own. */
	settingsFiles(projectDir: string, userHome: string): string[] {
		return this.fields.settingsFiles(projectDir, userHome);
	}

	/** The value `serverArgs` give the host flag, if any. */
	hostIn(serverArgs: readonly string[]): string | undefined {
		return flagValue(serverArgs, this.fields.hostFlags);
	}

	/** The port `serverArgs` give, if any: `undefined` when none, `NaN` when the value isn't a port. */
	portIn(serverArgs: readonly string[]): number | undefined {
		const value = flagValue(serverArgs, this.fields.portFlags);
		return value === undefined ? undefined : parsePort(value);
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

function parsePort(value: string): number {
	const port = /^\d+$/.test(value) ? Number(value) : NaN;
	return port > 0 && port < 65536 ? port : NaN;
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

/** The configs a serve starts a server for: the leaves, which no other config of `configs` extends. That picks the synced config over its source-rooted base, and each place over the config they share. */
export function leafConfigs(
	configs: readonly ResolvedConfig[]
): ResolvedConfig[] {
	const extended = new Set(configs.flatMap(({ parents }) => parents));
	return configs.filter(({ file }) => !extended.has(file));
}
