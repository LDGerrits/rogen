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
import {
	DiagnosticJson,
	diagnosticToJson,
} from "../../platform/diagnostics/diagnostic-json.js";

/** The server that a running serve serves each project file with, by the project file; none for one nothing serves. */
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

/** One project of a config, as `--json` lists it. */
interface ListedProject {
	readonly name: string;
	readonly file: string;
	/** Whether `rogen serve` serves it when no project is named. */
	readonly served: boolean;
	/** The port a place's project is served on; absent for anything that is not a place. */
	readonly port?: number;
	readonly serving: ListedServing | null;
}

interface ListedServing {
	readonly server: string;
	readonly host: string;
	readonly port: number;
	readonly clients: number | null;
}

/** What `--json` lists of a config that loads, fully resolved. */
interface ConfigDetails {
	readonly projectName: string;
	readonly sourcePaths: readonly string[];
	readonly commonRoot: string | null;
	readonly routes: Readonly<Record<string, string>>;
	readonly globIgnorePaths: readonly string[];
	readonly syncPath: string | null;
	readonly projectFile: string;
	/** The server a running serve serves the project file with, and how many Studio plugins are connected to it when it says. */
	readonly serving: ListedServing | null;
	/** Every project the config writes, `default` first. */
	readonly projects: readonly ListedProject[];
}

/** What `--json` lists of a place of a config. */
interface ListedPlace extends ConfigDetails {
	readonly place: string;
	/** The place's folder. */
	readonly folder: string;
}

/** What `--json` lists of one config: where it is, whether it loads, and its details when it does. */
interface ListedConfig extends Partial<ConfigDetails> {
	readonly config: string;
	readonly file: string;
	readonly status: ConfigEntry["status"];
	/** Whether `rogen serve` starts a server for it: it loads. */
	readonly served: boolean;
	/** The places it lists, when it lists any. */
	readonly places?: readonly ListedPlace[];
	readonly diagnostics: readonly DiagnosticJson[];
}

/** What `list --json` prints. */
interface ListDocument {
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

	/** The intro, one block per config (its file, then its values or its errors) and one per place, and the closing line when every config loads. `home` is the folder the configs are read from. */
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
			const parts = [
				...(among &&
				project.stem === project.serveProject &&
				!project.hasPlaces
					? ["served"]
					: []),
				...(project.placeServePort !== undefined
					? [`port ${project.placeServePort}`]
					: []),
			];
			return parts.length > 0 ? ` (${parts.join(", ")})` : "";
		};
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
							...(running(config) ? [running(config)] : []),
						]
					: [
							`projects:${projects
								.map(
									(project) =>
										`\n  ${project.stem}: ${relative(project.projectFile)}${notes(project, true)}${
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
		projects: projects.map((project) => ({
			name: project.stem,
			file: toNative(project.projectFile),
			served: project.stem === project.serveProject && !project.hasPlaces,
			...(project.placeServePort !== undefined
				? { port: project.placeServePort }
				: {}),
			serving: servingJson(serving.get(project.projectFile)),
		})),
	};
}
