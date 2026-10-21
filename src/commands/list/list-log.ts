import { ProjectError } from "../../base/errors.js";
import { relativeTo, toNative } from "../../base/path.js";
import path from "path";
import { plural, shellWord } from "../../base/strings.js";
import { unescapedGlob } from "../../base/glob.js";
import { ResolvedConfig } from "../../domain/config/resolved-config.js";
import {
	DEFAULT_CONFIG_FILE,
	configLabel,
	isDefaultConfigFileName,
} from "../../domain/config/config.js";
import { ConfigDifferences } from "../../domain/config/config-differences.js";
import { ConfigEntry } from "../../domain/config/config-service.js";
import { ServingNow } from "../../domain/serve/serve-service.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { LogService } from "../../platform/log/log-service.js";
import { BuildLog } from "../build/build-log.js";
import { OutputShape } from "../../platform/output/output-shape.js";
import {
	DiagnosticJson,
	diagnosticShape,
	diagnosticToJson,
} from "../../platform/diagnostics/diagnostic-json.js";

const S = OutputShape;

const servingShape = S.named(
	"Serving",
	S.object({
		server: S.string,
		host: S.string,
		port: S.integer,
		clients: S.nullable(S.integer),
	})
);

const detailsShape = {
	projectName: S.string,
	sourcePaths: S.array(S.string),
	commonRoot: S.nullable(S.string),
	routes: S.record(S.string),
	globIgnorePaths: S.array(S.string),
	syncPath: S.nullable(S.string),
	projectFile: S.string,
	serving: S.nullable(servingShape),
};

const serveShape = {
	port: S.optional(S.integer),
	placeIds: S.optional(S.array(S.integer)),
	rojo: S.optional(S.array(S.string)),
};

const optionalDetails = {
	...Object.fromEntries(
		Object.entries(detailsShape).map(([key, shape]) => [
			key,
			S.optional(shape),
		])
	),
	...serveShape,
};

/** The document of `list --json`; a config that doesn't load has no details. */
export const listDocumentShape = S.object({
	configs: S.array(
		S.object({
			config: S.string,
			file: S.string,
			status: S.enum("valid", "broken"),
			differsFromDefault: S.optional(S.array(S.string)),
			...optionalDetails,
			diagnostics: S.array(diagnosticShape),
		})
	),
});

/** What a build would say about the folders of each valid config, by config file. */
export type ProblemsByConfig = ReadonlyMap<string, readonly Diagnostic[]>;

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

const portOf = (project: ResolvedConfig): number | undefined =>
	project.project.servePort;

/** The Rojo command that serves the project. */
const rojoServe = (project: ResolvedConfig, file: string): string[] => {
	const port = portOf(project);
	return [
		"rojo",
		"serve",
		file,
		...(port === undefined ? [] : ["--port", String(port)]),
	];
};

const listed = (values: readonly string[]): string =>
	values.length > 0 ? values.join(", ") : "(none)";

const routeLines = ({ routes }: ResolvedConfig): string[] =>
	[...routes].map(([key, target]) => `${key} -> ${target.toString()}`);

interface ListedServing {
	readonly server: string;
	readonly host: string;
	readonly port: number;
	readonly clients: number | null;
}

interface ConfigDetails {
	readonly projectName: string;
	readonly sourcePaths: readonly string[];
	readonly commonRoot: string | null;
	readonly routes: Readonly<Record<string, string>>;
	readonly globIgnorePaths: readonly string[];
	readonly syncPath: string | null;
	readonly projectFile: string;
	readonly serving: ListedServing | null;
	readonly port?: number;
	readonly placeIds?: readonly number[];
	readonly rojo?: readonly string[];
}

interface ListedConfig extends Partial<ConfigDetails> {
	readonly config: string;
	readonly file: string;
	readonly status: ConfigEntry["status"];
	readonly differsFromDefault?: readonly string[];
	readonly diagnostics: readonly DiagnosticJson[];
}

interface ListDocument {
	readonly configs: readonly ListedConfig[];
}

export class ListLog {
	constructor(
		private readonly logService: LogService,
		private readonly cwd: string
	) {}

	static failure(entries: readonly ConfigEntry[]): Error | undefined {
		const broken = entries.filter(
			({ status }) => status === "broken"
		).length;
		if (broken === 0) return undefined;
		const verb = broken === 1 ? "has" : "have";
		return new ProjectError(
			broken === entries.length
				? `${plural(broken, "config")} ${verb} errors.`
				: `${broken} of ${entries.length} configs ${verb} errors.`
		);
	}

	/** The keys each valid config other than the default has other values for than the default, by config file; none without a valid default beside it. */
	static differences(
		entries: readonly ConfigEntry[]
	): ReadonlyMap<string, readonly string[]> {
		const base = entries.find(
			(entry) =>
				entry.status === "valid" &&
				isDefaultConfigFileName(path.basename(entry.file))
		);
		const differences = new Map<string, readonly string[]>();
		if (base?.status !== "valid") return differences;
		for (const entry of entries)
			if (
				entry.status === "valid" &&
				entry !== base &&
				!isDefaultConfigFileName(path.basename(entry.file))
			)
				differences.set(
					entry.file,
					ConfigDifferences.between(base.config, entry.config)
				);
		return differences;
	}

	print(
		entries: readonly ConfigEntry[],
		home?: string,
		serving: ServingByConfig = new Map(),
		problems: ProblemsByConfig = new Map()
	): void {
		const { logService } = this;
		new BuildLog(logService, this.cwd).begin("list", [], home);
		const printed: { label: string; routes: readonly string[] }[] = [];
		const differences = ListLog.differences(entries);
		let configs = 0;
		for (const entry of entries) {
			if (entry.status === "broken") {
				logService.section(relativeTo(this.cwd, entry.file));
				for (const error of entry.errors) logService.diagnostic(error);
				continue;
			}
			configs++;
			this.printConfig(
				relativeTo(this.cwd, entry.file),
				entry.config,
				printed,
				serving,
				differences.get(entry.file)
			);
			for (const problem of problems.get(entry.file) ?? [])
				logService.diagnostic(problem);
		}
		if (ListLog.failure(entries) === undefined)
			logService.outro(`${plural(configs, "config")}.`);
	}

	private printConfig(
		title: string,
		config: ResolvedConfig,
		printed: { label: string; routes: readonly string[] }[],
		serving: ServingByConfig,
		differs?: readonly string[]
	): void {
		const relative = (file: string) => relativeTo(this.cwd, file);
		const routes = routeLines(config);
		const sameAs = printed.find(
			(other) =>
				other.routes.length === routes.length &&
				other.routes.every((line, index) => line === routes[index])
		);
		printed.push({ label: config.label, routes });
		const notes = (project: ResolvedConfig): string => {
			const { servePlaceIds: placeIds } = project.project;
			const parts = [
				...(portOf(project) !== undefined
					? [`port ${portOf(project)}`]
					: []),
				...(placeIds.length > 0
					? [`place IDs ${placeIds.join(", ")}`]
					: []),
			];
			return parts.length > 0 ? ` (${parts.join(", ")})` : "";
		};
		const rojo = (project: ResolvedConfig): string =>
			rojoServe(project, relative(project.projectFile))
				.map(shellWord)
				.join(" ");
		const running = (project: ResolvedConfig): string => {
			const now = serving.get(project.projectFile);
			return now ? `serving: ${servingLine(now)}` : "";
		};
		this.logService.section(
			title,
			[
				`source paths: ${listed(config.sourcePaths.map(relative))}`,
				sameAs
					? `routes: same as ${sameAs.label}`
					: `routes:${routes.map((line) => `\n  ${line}`).join("")}`,
				`sync path: ${listed(config.syncPath ? [relative(config.syncPath)] : [])}`,
				`project file: ${relative(config.projectFile)}${notes(config)}`,
				`rojo: ${rojo(config)}`,
				...(running(config) ? [running(config)] : []),
				...(differs
					? [
							`differs from ${DEFAULT_CONFIG_FILE}: ${listed(differs)}`,
						]
					: []),
			].join("\n")
		);
	}

	json(
		entries: readonly ConfigEntry[],
		serving: ServingByConfig = new Map(),
		problems: ProblemsByConfig = new Map()
	): ListDocument {
		const differences = ListLog.differences(entries);
		return {
			configs: entries.map((entry) => ({
				config:
					entry.status === "valid"
						? entry.config.label
						: configLabel(entry.file),
				file: toNative(entry.file),
				status: entry.status,
				...(differences.has(entry.file)
					? { differsFromDefault: differences.get(entry.file) }
					: {}),
				...(entry.status === "valid"
					? configDetails(entry.config, serving)
					: {}),
				diagnostics:
					entry.status === "broken"
						? entry.errors.map(diagnosticToJson)
						: (problems.get(entry.file) ?? []).map(
								diagnosticToJson
							),
			})),
		};
	}
}

const servingJson = (serving: ServingNow | undefined): ListedServing | null =>
	serving
		? {
				server: serving.server.id,
				host: serving.host,
				port: serving.port,
				clients: serving.clients ?? null,
			}
		: null;

function configDetails(
	config: ResolvedConfig,
	serving: ServingByConfig
): ConfigDetails {
	const { servePlaceIds: placeIds } = config.project;
	const rojo = rojoServe(config, toNative(config.projectFile));
	return {
		projectName: config.projectName,
		sourcePaths: config.sourcePaths.map((file) => toNative(file)),
		commonRoot: config.commonRoot ? toNative(config.commonRoot) : null,
		routes: Object.fromEntries(
			[...config.routes].map(([key, target]) => [key, target.toString()])
		),
		globIgnorePaths: config.ignored.map(unescapedGlob),
		syncPath: config.syncPath ? toNative(config.syncPath) : null,
		projectFile: toNative(config.projectFile),
		serving: servingJson(serving.get(config.projectFile)),
		...(portOf(config) !== undefined ? { port: portOf(config) } : {}),
		...(placeIds.length > 0 ? { placeIds } : {}),
		rojo,
	};
}
