import path from "path";
import { parse } from "../../base/jsonc.js";
import { containsPosix } from "../../base/path.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { joinedWithAnd, plural } from "../../base/strings.js";
import {
	Diagnostic,
	errorDiagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import {
	FileReader,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { RogenConfig, configFileName } from "../config/config.js";
import { DeclaredKeys } from "../config/declared-keys.js";
import { isSupportedService } from "../roblox/supported-services.js";
import {
	MigratedConfig,
	MigratedProject,
	PlannedMove,
	ProjectMigration,
} from "../init/project-migration.js";
import { LegacyConfig } from "./legacy-config.js";
import { LayoutSettings, LegacyKeywords } from "./legacy-keywords.js";
import { LegacyMode, LegacySettings } from "./legacy-settings.js";
import { LegacyMarker, LegacySourceTree } from "./legacy-source-tree.js";

type Fields = Readonly<Record<string, unknown>>;

const SET_ASIDE = ".v1";

const MIGRATION_PAGE = LegacyConfig.MIGRATION_URL;

/** The words every migrated config routes by, as v1 always did. */
const ALWAYS_ROUTED = ["server", "client", "shared"];

const isObject = (value: unknown): value is Fields =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const posix = (file: string) => file.split(path.sep).join("/");

/** One v1 config, read with what the folder told v1 about it. */
interface FoundConfig {
	readonly file: string;
	readonly settings: LegacySettings;
	readonly project: Fields;
	/** The file the project came from, `inline` for the config's own, `fallback` for the one v1 made. */
	readonly projectFrom: string;
	readonly modes: readonly LegacyMode[];
}

/** Turns the Rogen 1 configs of a folder into v2 configs that place every file where v1 did. */
export class LegacyMigration implements ProjectMigration {
	async find(
		folder: string,
		files: FileReader
	): Promise<Result<MigratedProject | undefined, Diagnostic[]>> {
		const found: FoundConfig[] = [];
		const errors: Diagnostic[] = [];
		for (const file of await LegacyMigration.configsIn(folder, files)) {
			const read = await LegacyMigration.read(folder, file, files);
			if (read.isErr()) errors.push(read.error);
			else if (read.value) found.push(read.value);
		}
		if (errors.length > 0) return err(errors);
		if (found.length === 0) return ok(undefined);
		return ok(await new Migration(folder, files, found).run());
	}

	/** The `.rogen.json` files of `folder`, `.rogen.json` first. */
	private static async configsIn(
		folder: string,
		files: FileReader
	): Promise<string[]> {
		const listing = await tryWithAsync(() => files.readDirectory(folder));
		if (listing.isErr()) return [];
		return listing.value
			.filter(
				([name, type]) =>
					isFileType(type) && LegacyConfig.FILE_NAME.test(name)
			)
			.map(([name]) => name)
			.sort((a, b) => a.localeCompare(b));
	}

	private static async read(
		folder: string,
		file: string,
		files: FileReader
	): Promise<Result<FoundConfig | undefined, Diagnostic>> {
		const text = await tryWithAsync(() =>
			files.readFile(path.join(folder, file))
		);
		if (text.isErr()) return ok(undefined);
		const value = parse(text.value);
		if (value.isErr() || !LegacyConfig.detects(value.value))
			return ok(undefined);
		const settings = new LegacySettings(value.value as Fields);
		const project = await LegacyMigration.projectOf(
			folder,
			file,
			settings,
			files
		);
		if (project.isErr()) return err(project.error);
		const exists = (name: string) => files.exists(path.join(folder, name));
		const typeScript = await exists("tsconfig.json");
		const darklua =
			(await exists(".darklua.json")) || (await exists(".darklua.json5"));
		const modes = settings.modes.filter(({ name }) =>
			name === "luau"
				? !typeScript
				: name === "ts"
					? typeScript
					: name === "darklua"
						? darklua
						: true
		);
		return ok({
			file,
			settings,
			project: project.value,
			projectFrom:
				typeof settings.project === "string"
					? settings.project
					: settings.project
						? "inline"
						: "fallback",
			modes,
		});
	}

	/** The base project v1 merged its routes into: the config's, the file it names, or the one v1 made from the folder. */
	private static async projectOf(
		folder: string,
		file: string,
		settings: LegacySettings,
		files: FileReader
	): Promise<Result<Fields, Diagnostic>> {
		const { project } = settings;
		if (isObject(project)) return ok(project);
		if (typeof project === "string") {
			const text = await tryWithAsync(() =>
				files.readFile(path.resolve(folder, project))
			);
			const value = text.isOk() ? parse(text.value) : undefined;
			return value?.isOk() && isObject(value.value)
				? ok(value.value)
				: err(
						errorDiagnostic(
							"legacy.projectUnreadable",
							{ resource: path.join(folder, file) },
							`its "project" names ${project}, which couldn't be read as a project file, so init can't take its tree. Fix the path or the file, then run 'rogen init' again.`
						)
					);
		}
		return ok(await LegacyMigration.fallbackProject(folder, files));
	}

	/** The project v1 made for a config without one, from the packages and compiler the folder has. */
	private static async fallbackProject(
		folder: string,
		files: FileReader
	): Promise<Fields> {
		const exists = (...parts: string[]) =>
			files.exists(path.join(folder, ...parts));
		const tree: Record<string, Record<string, unknown>> = {};
		const add = (service: string, key: string, node: unknown) => {
			tree[service] = { ...tree[service], [key]: node };
		};
		const typeScript = await exists("tsconfig.json");
		if (typeScript) {
			const modules: Record<string, unknown> = {};
			for (const scope of ["@rbxts", "@flamework", "@rbxts-js"])
				if (await exists("node_modules", scope))
					modules[scope] = { $path: `node_modules/${scope}` };
			add("ReplicatedStorage", "rbxts_include", {
				$path: "include",
				...(Object.keys(modules).length > 0 && {
					node_modules: { $className: "Folder", ...modules },
				}),
			});
		}
		const packages: [string, string, string][] = [];
		if (await exists("wally.toml"))
			packages.push(
				["ReplicatedStorage", "Packages", "Packages"],
				["ServerScriptService", "ServerPackages", "ServerPackages"]
			);
		if (await exists("pesde.toml"))
			packages.push(
				["ReplicatedStorage", "Packages", "roblox_packages"],
				[
					"ServerScriptService",
					"ServerPackages",
					"roblox_server_packages",
				]
			);
		for (const [service, key, folderName] of packages)
			if (await exists(folderName))
				add(service, key, { $path: folderName });
		return {
			name: path.basename(folder) || "roblox-game",
			...(typeScript && {
				globIgnorePaths: ["**/package.json", "**/tsconfig.json"],
			}),
			tree: { $className: "DataModel", ...tree },
		};
	}
}

/** What to do about a v1 marker file that no rename carries over. */
const MARKER_ADVICE: Readonly<Record<LegacyMarker, string>> = {
	structure:
		"v1 kept the names in this folder from routing. v2 has no such marker: a folder's route covers everything inside it, so put an @ marker of the route here, such as @Shared, and delete this file.",
	unwrap: "v1 left out the wrapper folder for this folder. v2 has no such marker: give the folder a route of its own whose target has no wrapper, and delete this file.",
	sync: "v1 mounted this folder as it is. v2 has no such marker: mount the folder with a $path node in the tree, and delete this file.",
};

/** One run over the v1 configs of a folder. */
class Migration {
	private readonly warnings: Diagnostic[] = [];
	private readonly configs: MigratedConfig[] = [];
	private readonly renames = new Map<string, PlannedMove>();

	constructor(
		private readonly folder: string,
		private readonly files: FileReader,
		private readonly found: readonly FoundConfig[]
	) {}

	async run(): Promise<MigratedProject> {
		for (const config of this.found) await this.migrate(config);
		const from = this.found.map(({ file }) => file);
		const outputs = await this.outputsThere();
		const [server] = Object.entries(
			this.configs[0]?.config.routes ?? {}
		).filter(([key]) => key.toLowerCase() === "server");
		return {
			label:
				from.length === 1
					? "a Rogen 1 config"
					: `${from.length} Rogen 1 configs`,
			from,
			configs: this.configs,
			moves: [
				...from.map((file) => ({
					from: file,
					to: `${file}${SET_ASIDE}`,
				})),
				...this.renames.values(),
			],
			notes: [
				...this.found.map(Migration.treeNote),
				...(outputs.length > 0
					? [
							`v1 wrote ${joinedWithAnd(outputs)}, which init doesn't lift: 'rogen write' writes ${outputs.length === 1 ? "it" : "them"} now.`,
						]
					: []),
				...(server
					? [
							`The routes send each file where v1 did, such as ${server[0]} files to ${server[1]}, so requires keep working.`,
						]
					: []),
				...(this.renames.size > 0
					? [
							`Renames ${plural(this.renames.size, "file")} that v1 routed by a word in the name or by a marker file to v2's @ form, which keeps each instance's name.`,
						]
					: []),
			],
			warnings: this.warnings.filter(
				(warning, at) =>
					this.warnings.findIndex(
						(other) =>
							other.code === warning.code &&
							other.resource === warning.resource &&
							other.message === warning.message
					) === at
			),
			edits: [
				"Run 'rogen check' and fix what it reports.",
				`Serve the project and compare Studio's Explorer with your v1 build. When every script sits where it did, delete ${joinedWithAnd(from.map((file) => `${file}${SET_ASIDE}`))}. See ${MIGRATION_PAGE}.`,
			],
		};
	}

	private static treeNote({ file, projectFrom }: FoundConfig): string {
		return projectFrom === "inline"
			? `Took the tree from the "project" of ${file}.`
			: projectFrom === "fallback"
				? `Took the tree v1 made for ${file}, which has no "project".`
				: `Took the tree from ${projectFrom}, which the "project" of ${file} names.`;
	}

	private resource(file: string): string {
		return path.join(this.folder, file);
	}

	/** The project files v1 wrote that are there now. */
	private async outputsThere(): Promise<string[]> {
		const outputs = [
			...new Set(
				this.found.flatMap(({ modes }) =>
					modes.map(({ output }) => posix(path.normalize(output)))
				)
			),
		];
		const there = await Promise.all(
			outputs.map((output) =>
				this.files.exists(path.join(this.folder, output))
			)
		);
		return outputs.filter((_, at) => there[at]);
	}

	private async migrate(found: FoundConfig): Promise<void> {
		const { file, settings, modes } = found;
		const layout = settings.layout(
			found.project.emitLegacyScripts !== false
		);
		const aliases = this.routableAliases(file, settings.aliases);
		const keywords = new LegacyKeywords(aliases);
		const tree = await new LegacySourceTree(
			this.files,
			this.folder,
			keywords,
			settings.knownTags,
			settings.verbatim,
			(word) => keywords.keyOf(word),
			(word) => keywords.targetOf(word, layout)
		).scan(settings.source);
		const routes = Migration.routesOf(
			Object.keys(aliases),
			keywords,
			layout,
			tree.used
		);
		this.reportTree(file, tree);
		for (const move of tree.moves) this.addRename(file, move);
		const tagged =
			Object.keys(settings.tags).length > 0 ||
			modes.some(({ tags }) => Object.keys(tags).length > 0);
		if (tagged) this.warnTags(file, settings, tree.tagged);
		for (const mode of modes) this.addConfig(found, mode, routes);
	}

	/** The aliases a route can carry over: a valid route key, to a service, as v1 needed. */
	private routableAliases(
		file: string,
		aliases: Readonly<Record<string, string>>
	): Record<string, string> {
		const routable: Record<string, string> = {};
		for (const [key, service] of Object.entries(aliases)) {
			const problem = !DeclaredKeys.isName(key)
				? "can't be a route key, which is letters and digits that start with a letter"
				: !Migration.isService(service.split(".")[0])
					? `sends files to ${service}, which is not a service`
					: undefined;
			if (problem === undefined) routable[key] = service;
			else
				this.warnings.push(
					warningDiagnostic(
						"legacy.aliasKey",
						{ resource: this.resource(file) },
						`the alias "${key}" ${problem}, so it has no route. Add the route you want by hand, and rename the files that use the alias.`
					)
				);
		}
		return routable;
	}

	private static isService(name: string): boolean {
		return isSupportedService(name) || LegacyKeywords.isNestedService(name);
	}

	private static routesOf(
		aliases: readonly string[],
		keywords: LegacyKeywords,
		layout: LayoutSettings,
		used: ReadonlySet<string>
	): Record<string, string> {
		const words = [
			...ALWAYS_ROUTED,
			...[
				...new Set([
					...aliases.map((key) => key.toLowerCase()),
					...used,
				]),
			]
				.filter((word) => !ALWAYS_ROUTED.includes(word))
				.sort(),
		];
		const routes: Record<string, string> = {};
		for (const word of new Set(words))
			routes[keywords.keyOf(word)] = keywords.targetOf(word, layout);
		routes[DeclaredKeys.FALLBACK_ROUTE] =
			LegacyKeywords.fallbackTarget(layout);
		return routes;
	}

	private addConfig(
		{ file, settings, project }: FoundConfig,
		mode: LegacyMode,
		routes: Record<string, string>
	): void {
		const output = posix(path.normalize(mode.output));
		const outputDir = path.posix.dirname(output);
		const stem = path.posix
			.basename(output)
			.replace(/\.project\.json$/, "");
		const fileName = path.posix.join(outputDir, configFileName(stem));
		const taken = this.configs.find(
			(config) => config.fileName === fileName
		);
		if (taken) {
			this.warnings.push(
				warningDiagnostic(
					"legacy.outputClash",
					{ resource: this.resource(file) },
					`its ${mode.name} mode wrote ${output}, as an earlier mode did, so init writes only one ${fileName}. To keep both, copy ${fileName}, give the copy another name and edit it.`
				)
			);
			return;
		}
		const fromOutput = (sourcePath: string) =>
			posix(path.relative(outputDir, path.normalize(sourcePath))) || ".";
		const compiled = !settings.source.some((sourcePath) =>
			containsPosix(
				posix(path.normalize(mode.build)),
				posix(path.normalize(sourcePath))
			)
		);
		const {
			tree,
			globIgnorePaths: projectIgnores,
			...rojoKeys
		} = project as Fields & { globIgnorePaths?: unknown };
		const globIgnorePaths = [
			...new Set([
				...(Array.isArray(projectIgnores)
					? projectIgnores.filter(
							(glob): glob is string => typeof glob === "string"
						)
					: []),
				...settings.globIgnorePaths,
				...mode.globIgnorePaths,
			]),
		];
		const config: RogenConfig = {
			...(rojoKeys as RogenConfig),
			sourcePaths: settings.source.map(fromOutput),
			routes,
			...(compiled && { compiledPath: fromOutput(mode.build) }),
			...(globIgnorePaths.length > 0 && { globIgnorePaths }),
			...(isObject(tree) && { tree: tree as RogenConfig["tree"] }),
		};
		this.configs.push({ fileName, config });
	}

	private addRename(file: string, move: PlannedMove): void {
		const planned = this.renames.get(move.from);
		if (planned === undefined) {
			this.renames.set(move.from, move);
			return;
		}
		if (planned.to !== move.to)
			this.warnings.push(
				warningDiagnostic(
					"legacy.renameClash",
					{ resource: this.resource(move.from) },
					`${file} routes this file as ${path.posix.basename(move.to)}, and another config as ${path.posix.basename(planned.to)}, so init renames it to ${path.posix.basename(planned.to)}. Check where it lands with 'rogen where'.`
				)
			);
	}

	private reportTree(file: string, tree: LegacySourceTree): void {
		for (const { marker, folder } of tree.markers)
			this.warnings.push(
				warningDiagnostic(
					"legacy.marker",
					{ resource: this.resource(`${folder}/.${marker}`) },
					MARKER_ADVICE[marker]
				)
			);
		for (const { file: kept, name } of tree.typeScript)
			this.warnings.push(
				warningDiagnostic(
					"legacy.typeScriptName",
					{ resource: this.resource(kept) },
					`v1 routed this file by a word in its name, which v2 doesn't read. init leaves it as it is, since renaming it breaks the imports of it: rename it to ${name} and update those imports.`
				)
			);
		for (const { file: moved, before, after } of tree.outranked)
			this.warnings.push(
				warningDiagnostic(
					"legacy.outrankedRoute",
					{ resource: this.resource(moved) },
					`v1 put this file in ${before}, by the last routing word in its path, and v2 puts it in ${after}: in v2 the outermost route governs. To keep it where it was, move it out of the folder that routes it to ${after}.`
				)
			);
		for (const { file: kept, name } of tree.clashes)
			this.warnings.push(
				warningDiagnostic(
					"legacy.renameClash",
					{ resource: this.resource(kept) },
					`v1 routed this file by a word in its name, and ${name}, the name that keeps it there in v2, is taken in its folder, so init leaves it as it is. Rename one of them. ${file} is the config that routed it.`
				)
			);
	}

	private warnTags(
		file: string,
		settings: LegacySettings,
		tagged: readonly string[]
	): void {
		const tags = Object.keys(settings.tags);
		this.warnings.push(
			warningDiagnostic(
				"legacy.tags",
				{ resource: this.resource(file) },
				`v1's tags${tags.length > 0 ? ` (${joinedWithAnd(tags)})` : ""} aren't carried over: v2 has none, and init renames none of the files they pick${tagged.length > 0 ? `, ${Migration.listed(tagged)}` : ""}. Move each into a folder of its own, and list that folder after the other source paths in the configs that should have it: its files replace the ones at the same path.`
			)
		);
	}

	private static listed(items: readonly string[]): string {
		const shown = 5;
		return items.length > shown
			? `${items.slice(0, shown).join(", ")} and ${items.length - shown} more`
			: joinedWithAnd(items);
	}
}
