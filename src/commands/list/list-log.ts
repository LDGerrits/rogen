import { ProjectError } from "../../base/errors.js";
import { relativeTo, toNative } from "../../base/path.js";
import { joinedWithAnd, plural } from "../../base/strings.js";
import { unescapedGlob } from "../../base/glob.js";
import {
	ResolvedConfig,
	ResolvedConfigFile,
	placesIn,
} from "../../domain/config/resolved-config.js";
import { configLabel } from "../../domain/config/config.js";
import { ConfigEntry } from "../../domain/config/config-service.js";
import { ServingNow } from "../../domain/serve/serve-service.js";
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

const projectShape = S.named(
	"Project",
	S.object({
		name: S.string,
		file: S.string,
		served: S.boolean,
		port: S.optional(S.integer),
		placeIds: S.optional(S.array(S.integer)),
		rojo: S.optional(S.array(S.string)),
		serving: S.nullable(servingShape),
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
	projects: S.array(projectShape),
};

const optionalDetails = Object.fromEntries(
	Object.entries(detailsShape).map(([key, shape]) => [key, S.optional(shape)])
);

/** The document of `list --json`; a config that doesn't load has no details. */
export const listDocumentShape = S.object({
	configs: S.array(
		S.object({
			config: S.string,
			file: S.string,
			status: S.enum("valid", "broken"),
			served: S.boolean,
			...optionalDetails,
			places: S.optional(
				S.array(
					S.object({
						place: S.string,
						folder: S.string,
						...detailsShape,
					})
				)
			),
			diagnostics: S.array(diagnosticShape),
		})
	),
});

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
	project.placeServePort ?? project.project.servePort;

/** The Rojo command that serves the project, unless its config lists places and is never served. */
const rojoServe = (
	project: ResolvedConfig,
	file: (project: ResolvedConfig) => string
): string[] | undefined =>
	project.hasPlaces ? undefined : ["rojo", "serve", file(project)];

const listed = (values: readonly string[]): string =>
	values.length > 0 ? values.join(", ") : "(none)";

const routeLines = ({ routes }: ResolvedConfig): string[] =>
	[...routes].map(([key, target]) => `${key} -> ${target.toString()}`);

interface ListedProject {
	readonly name: string;
	readonly file: string;
	readonly served: boolean;
	readonly port?: number;
	readonly placeIds?: readonly number[];
	readonly rojo?: readonly string[];
	readonly serving: ListedServing | null;
}

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
	readonly projects: readonly ListedProject[];
}

interface ListedPlace extends ConfigDetails {
	readonly place: string;
	readonly folder: string;
}

interface ListedConfig extends Partial<ConfigDetails> {
	readonly config: string;
	readonly file: string;
	readonly status: ConfigEntry["status"];
	readonly served: boolean;
	readonly places?: readonly ListedPlace[];
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

	print(
		entries: readonly ConfigEntry[],
		home?: string,
		serving: ServingByConfig = new Map()
	): void {
		const { logService } = this;
		new BuildLog(logService, this.cwd).begin("list", [], home);
		const printed: { label: string; routes: readonly string[] }[] = [];
		let configs = 0;
		let places = 0;
		for (const entry of entries) {
			if (entry.status === "broken") {
				logService.section(relativeTo(this.cwd, entry.file));
				for (const error of entry.errors) logService.diagnostic(error);
				continue;
			}
			if (entry.scope === undefined) {
				configs++;
				this.printConfig(
					relativeTo(this.cwd, entry.file),
					entry,
					entry.config.hasPlaces
						? placesIn(entry).map(({ config }) => config.label)
						: [],
					printed,
					serving
				);
			}
			for (const place of placesIn(entry, entry.scope)) {
				places++;
				this.printConfig(
					`${relativeTo(this.cwd, place.config.projectDir)} (place)`,
					place,
					[],
					printed,
					serving
				);
			}
		}
		if (ListLog.failure(entries) === undefined)
			logService.outro(
				`${joinedWithAnd([
					...(configs > 0 || places === 0
						? [plural(configs, "config")]
						: []),
					...(places > 0 ? [plural(places, "place")] : []),
				])}.`
			);
	}

	private printConfig(
		title: string,
		resolved: ResolvedConfigFile,
		placeNames: readonly string[],
		printed: { label: string; routes: readonly string[] }[],
		serving: ServingByConfig
	): void {
		const relative = (file: string) => relativeTo(this.cwd, file);
		const { config } = resolved;
		const projects = [config, ...resolved.projects];
		const routes = routeLines(config);
		const sameAs = printed.find(
			(other) =>
				other.routes.length === routes.length &&
				other.routes.every((line, index) => line === routes[index])
		);
		printed.push({ label: config.label, routes });
		const notes = (project: ResolvedConfig, among: boolean): string => {
			const { servePlaceIds: placeIds } = project.project;
			const parts = [
				...(among &&
				project.stem === project.serveProject &&
				!project.hasPlaces
					? ["served"]
					: []),
				...(portOf(project) !== undefined
					? [`port ${portOf(project)}`]
					: []),
				...(placeIds.length > 0
					? [`place IDs ${placeIds.join(", ")}`]
					: []),
			];
			return parts.length > 0 ? ` (${parts.join(", ")})` : "";
		};
		const rojo = (project: ResolvedConfig): string[] =>
			rojoServe(project, ({ projectFile }) => relative(projectFile)) ??
			[];
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
				...(placeNames.length > 0
					? [`places: ${placeNames.join(", ")}`]
					: []),
				...(resolved.projects.length === 0
					? [
							`project file: ${relative(config.projectFile)}${notes(config, false)}`,
							...(rojo(config).length > 0
								? [`rojo: ${rojo(config).join(" ")}`]
								: []),
							...(running(config) ? [running(config)] : []),
						]
					: [
							`projects:${projects
								.map(
									(project) =>
										`\n  ${project.stem}: ${relative(project.projectFile)}${notes(project, true)}${
											rojo(project).length > 0
												? `\n    ${rojo(project).join(" ")}`
												: ""
										}${
											running(project)
												? `, ${running(project)}`
												: ""
										}`
								)
								.join("")}`,
						]),
			].join("\n")
		);
	}

	json(
		entries: readonly ConfigEntry[],
		serving: ServingByConfig = new Map()
	): ListDocument {
		return {
			configs: entries.map((entry) => ({
				config:
					entry.status === "valid"
						? entry.config.label
						: configLabel(entry.file),
				file: toNative(entry.file),
				status: entry.status,
				served:
					entry.status === "valid" &&
					(entry.scope !== undefined || !entry.config.hasPlaces),
				...(entry.status === "valid" && entry.scope === undefined
					? configDetails([entry.config, ...entry.projects], serving)
					: {}),
				...(entry.status === "valid" &&
				placesIn(entry, entry.scope).length > 0
					? {
							places: placesIn(entry, entry.scope).map(
								(place) => ({
									place: place.config.label,
									folder: toNative(place.config.projectDir),
									...configDetails(
										[place.config, ...place.projects],
										serving
									),
								})
							),
						}
					: {}),
				diagnostics:
					entry.status === "broken"
						? entry.errors.map(diagnosticToJson)
						: [],
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
	projects: readonly ResolvedConfig[],
	serving: ServingByConfig
): ConfigDetails {
	const [config] = projects;
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
		projects: projects.map((project) => {
			const { servePlaceIds: placeIds } = project.project;
			const rojo = rojoServe(project, ({ projectFile }) =>
				toNative(projectFile)
			);
			return {
				name: project.stem,
				file: toNative(project.projectFile),
				served:
					project.stem === project.serveProject && !project.hasPlaces,
				...(portOf(project) !== undefined
					? { port: portOf(project) }
					: {}),
				...(placeIds.length > 0 ? { placeIds } : {}),
				...(rojo ? { rojo } : {}),
				serving: servingJson(serving.get(project.projectFile)),
			};
		}),
	};
}
