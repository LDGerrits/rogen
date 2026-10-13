import { relativeTo, toNative } from "../../base/path.js";
import { plural } from "../../base/strings.js";
import { unescapedGlob } from "../../base/glob.js";
import {
	ResolvedConfig,
	configLabel,
	directExtendersOf,
	leafConfigs,
} from "../../domain/config/config.js";
import { ConfigEntry } from "../../domain/config/config-service.js";
import { ServingNow } from "../../domain/serve/serve-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { BuildLog } from "../build/build-log.js";
import {
	DiagnosticJson,
	diagnosticToJson,
} from "../../platform/diagnostics/diagnostic-json.js";

/** The server that a running serve serves each config with, by the config file; none for a config nothing serves. */
export type ServingByConfig = ReadonlyMap<string, ServingNow | undefined>;

/** A running serve in words: `Rojo at 127.0.0.1:34872, 1 Studio connected`. */
const servingLine = ({ server, host, port, clients }: ServingNow): string =>
	`${server.name} at ${host}:${port}${
		clients === undefined
			? ""
			: clients === 0
				? ", no Studio connected"
				: `, ${clients} Studio connected`
	}`;

const listed = (values: readonly string[]): string =>
	values.length > 0 ? values.join(", ") : "(none)";

/** The resolved routes as `key -> target`, in the config's order. */
const routeLines = ({ routes }: ResolvedConfig): string[] =>
	[...routes].map(([key, target]) => `${key} -> ${target.toString()}`);

/** What `--json` lists of a config that loads, fully resolved. */
export interface ConfigDetails {
	readonly projectName: string;
	readonly rootDirs: readonly string[];
	readonly commonRoot: string | null;
	readonly routes: Readonly<Record<string, string>>;
	readonly exclude: readonly string[];
	readonly template: string | null;
	readonly templates: readonly string[];
	readonly syncDir: string | null;
	readonly outFile: string;
	/** The server a running serve serves the project file with, and how many Studio plugins are connected to it when it says. */
	readonly serving: {
		readonly server: string;
		readonly host: string;
		readonly port: number;
		readonly clients: number | null;
	} | null;
}

/** What `--json` lists of one config: where it is, whether it loads, and its details when it does. */
export interface ListedConfig extends Partial<ConfigDetails> {
	readonly config: string;
	readonly file: string;
	readonly status: ConfigEntry["status"];
	readonly extends: readonly string[];
	/** The configs listed that extend it directly. */
	readonly extendedBy: readonly string[];
	/** Whether `rogen serve` starts a server for it: it loads and no listed config extends it. */
	readonly served: boolean;
	readonly diagnostics: readonly DiagnosticJson[];
}

/** What `list --json` prints. */
export interface ListDocument {
	readonly configs: readonly ListedConfig[];
}

/** The configs a run read: as lines relative to the working dir, or as one JSON document with an entry per config. */
export class ListLog {
	constructor(
		private readonly logService: LogService,
		private readonly cwd: string
	) {}

	/** The run's result when some configs are broken; none when every one loads. */
	static failure(entries: readonly ConfigEntry[]): Error | undefined {
		const broken = entries.filter(
			({ status }) => status === "broken"
		).length;
		if (broken === 0) return undefined;
		const verb = broken === 1 ? "has" : "have";
		return new Error(
			broken === entries.length
				? `${plural(broken, "config")} ${verb} errors.`
				: `${broken} of ${entries.length} configs ${verb} errors.`
		);
	}

	/** The intro, one block per config (its file, what it extends, then its values or its errors), and the closing line when every config loads. `home` is the folder the configs are read from. */
	print(
		entries: readonly ConfigEntry[],
		home?: string,
		serving: ServingByConfig = new Map()
	): void {
		const { logService } = this;
		new BuildLog(logService, this.cwd).begin("list", [], home);
		const relative = (file: string) => relativeTo(this.cwd, file);
		const printed: { label: string; routes: readonly string[] }[] = [];
		for (const entry of entries) {
			const extenders = directExtendersOf(entry, entries);
			const extended = [
				...(entry.parents.length > 0
					? [`extends: ${entry.parents.map(relative).join(" -> ")}`]
					: []),
				...(extenders.length > 0
					? [
							`extended by: ${extenders.map(({ file }) => relative(file)).join(", ")}`,
						]
					: []),
			];
			if (entry.status === "broken") {
				logService.section(
					relative(entry.file),
					extended.join("\n") || undefined
				);
				for (const error of entry.errors) logService.diagnostic(error);
				continue;
			}
			const { config } = entry;
			const label = configLabel(entry.file);
			const routes = routeLines(config);
			const sameAs = printed.find(
				(other) =>
					other.routes.length === routes.length &&
					other.routes.every((line, index) => line === routes[index])
			);
			printed.push({ label, routes });
			logService.section(
				relative(entry.file),
				[
					...extended,
					`root dirs: ${listed(config.rootDirs.map(relative))}`,
					sameAs
						? `routes: same as ${sameAs.label}`
						: `routes:${routes.map((line) => `\n  ${line}`).join("")}`,
					...(config.template
						? [
								`template: ${[config.template.file, ...[...config.template.bases].reverse()].map(relative).join(", over ")}`,
							]
						: []),
					`sync dir: ${listed(config.syncDir ? [relative(config.syncDir)] : [])}`,
					`project file: ${relative(config.outFile)}`,
					...(serving.get(entry.file)
						? [`serving: ${servingLine(serving.get(entry.file)!)}`]
						: []),
				].join("\n")
			);
		}
		if (ListLog.failure(entries) === undefined)
			logService.outro(`${plural(entries.length, "config")}.`);
	}

	json(
		entries: readonly ConfigEntry[],
		serving: ServingByConfig = new Map()
	): ListDocument {
		const leaves = new Set(leafConfigs(entries));
		return {
			configs: entries.map((entry) => ({
				config: configLabel(entry.file),
				file: toNative(entry.file),
				status: entry.status,
				extends: entry.parents.map((file) => toNative(file)),
				extendedBy: directExtendersOf(entry, entries).map(({ file }) =>
					toNative(file)
				),
				served: entry.status === "valid" && leaves.has(entry),
				...(entry.status === "valid"
					? configDetails(entry.config, serving.get(entry.file))
					: {}),
				diagnostics:
					entry.status === "broken"
						? entry.errors.map(diagnosticToJson)
						: [],
			})),
		};
	}
}

function configDetails(
	config: ResolvedConfig,
	serving: ServingNow | undefined
): ConfigDetails {
	return {
		projectName: config.projectName,
		rootDirs: config.rootDirs.map((file) => toNative(file)),
		commonRoot: config.commonRoot ? toNative(config.commonRoot) : null,
		routes: Object.fromEntries(
			[...config.routes].map(([key, target]) => [key, target.toString()])
		),
		exclude: config.exclude.map(unescapedGlob),
		template: config.template ? toNative(config.template.file) : null,
		templates: config.template
			? [...config.template.bases, config.template.file].map((file) =>
					toNative(file)
				)
			: [],
		syncDir: config.syncDir ? toNative(config.syncDir) : null,
		outFile: toNative(config.outFile),
		serving: serving
			? {
					server: serving.server.id,
					host: serving.host,
					port: serving.port,
					clients: serving.clients ?? null,
				}
			: null,
	};
}
