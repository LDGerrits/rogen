import path from "path";
import { UsageError } from "../../base/errors.js";
import { isObject } from "../../base/objects.js";
import { normalizeDir, containsPosix } from "../../base/path.js";
import { joinedWithAnd } from "../../base/strings.js";
import {
	Diagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { ROGEN_BLOCK, defaultSourcePaths } from "../config/config.js";
import { DeclaredKeys } from "../config/declared-keys.js";
import { Language, PlannedFile } from "../toolchain/toolchain.js";
import { CodeFinder } from "./code-finder.js";
import { ConfigEdit } from "./config-edit.js";
import { InitDirectory } from "./init-directory.js";
import { oneOf } from "./init-questions.js";
import { StartingRoutes } from "./starting-routes.js";

/** What a run changes about a project that has a config; every field is a change to make, so an empty request changes nothing. */
export interface ChangeRequest {
	/** Standard route ids to add. */
	readonly routes?: readonly string[];
	/** Standard route ids to take off. */
	readonly unroutes?: readonly string[];
	readonly unmatched?: "shared" | "leave";
	readonly sourcePaths?: readonly string[];
	readonly unsourcePaths?: readonly string[];
	readonly darklua?: boolean;
	/** Where Darklua writes, when it is added. */
	readonly syncPath?: string;
	/** Mounts to add, by path. */
	readonly packages?: readonly string[];
}

/** What a request writes, for the plan builder to take. */
export interface ChangePlan {
	/** The config with its changes, or none when there are none. */
	readonly config?: PlannedFile;
	readonly files: readonly PlannedFile[];
	readonly directories: readonly string[];
	readonly notes: readonly string[];
	readonly warnings: readonly Diagnostic[];
	readonly setup: readonly string[];
	readonly run: readonly string[];
	readonly edits: readonly string[];
	/** Set when the request turns Darklua on, so its pin is asked for. */
	readonly usesDarklua?: boolean;
}

const stringsOf = (value: unknown): string[] =>
	Array.isArray(value)
		? value.filter((one): one is string => typeof one === "string")
		: [];

/** Every `$path` a tree mounts, as the folder it names. */
export function mountedIn(node: unknown): string[] {
	if (!isObject(node)) return [];
	const own = node.$path;
	const target = isObject(own) ? own.optional : own;
	return [
		...(typeof target === "string" ? [normalizeDir(target)] : []),
		...Object.entries(node)
			.filter(([key]) => !key.startsWith("$"))
			.flatMap(([, child]) => mountedIn(child)),
	];
}

/** The changes a run makes to the config of a project, each as an edit of its text. */
export class ConfigChanges {
	private readonly notes: string[] = [];
	private readonly warnings: Diagnostic[] = [];
	private readonly files: PlannedFile[] = [];
	private readonly directories: string[] = [];
	private readonly setup: string[] = [];
	private readonly run: string[] = [];
	private readonly edits: string[] = [];
	private usesDarklua: boolean | undefined;

	constructor(
		private readonly fileSystemService: FileReader,
		private readonly directory: InitDirectory,
		private readonly edit: ConfigEdit,
		private readonly language: Language,
		/** The tree takes routes: its root is a DataModel. */
		private readonly routed: boolean
	) {}

	/** The routes and source paths the config has, as the loader reads them. */
	get sourcePaths(): string[] {
		const sourcePaths = this.edit.valueAt([ROGEN_BLOCK, "sourcePaths"]);
		return Array.isArray(sourcePaths)
			? stringsOf(sourcePaths).map(normalizeDir)
			: defaultSourcePaths(Object.keys(this.routes).length > 0);
	}

	/** The keys of the routes the config has, without the one for unmatched files. */
	private routeKeys(): string[] {
		return Object.keys(this.routes).filter(
			(key) => key !== DeclaredKeys.FALLBACK_ROUTE
		);
	}

	private get routes(): Record<string, unknown> {
		const routes = this.edit.valueAt([ROGEN_BLOCK, "routes"]);
		return isObject(routes) ? routes : {};
	}

	async apply(request: ChangeRequest): Promise<ChangePlan> {
		this.changeRoutes(request);
		this.changeUnmatched(request);
		await this.changeSourcePaths(request);
		this.changeDarklua(request);
		this.changePackages(request);
		const config = this.edit.planned;
		return {
			...(config && { config }),
			files: this.files,
			directories: this.directories,
			notes: this.notes,
			warnings: this.warnings,
			setup: this.setup,
			run: this.run,
			edits: this.edits,
			...(this.usesDarklua !== undefined && {
				usesDarklua: this.usesDarklua,
			}),
		};
	}

	private needRoutes(flag: string): void {
		if (!this.routed)
			throw new UsageError(
				`${flag} is for a project that takes routes, and the tree of ${this.edit.fileName} is not a DataModel, as in a model or a plugin.`
			);
	}

	/** The key of `routes` that spells `key`, however its first letter is cased. */
	private routeKeyFor(key: string): string | undefined {
		const identity = DeclaredKeys.identityOf(key);
		return Object.keys(this.routes).find(
			(one) => DeclaredKeys.identityOf(one) === identity
		);
	}

	private changeRoutes({ routes = [], unroutes = [] }: ChangeRequest): void {
		if (routes.length + unroutes.length === 0) return;
		this.needRoutes(routes.length > 0 ? "--route" : "--no-route");
		const starting = new StartingRoutes(this.language);
		const options = starting.options;
		const optionOf = (id: string, flag: string) => {
			const known = oneOf(
				id,
				options.map((option) => option.id),
				"a standard route",
				flag
			);
			return options.find((option) => option.id === known)!;
		};
		const keys = this.routeKeys();
		const lowercase =
			keys.length > 0 &&
			keys.every((key) => key === DeclaredKeys.identityOf(key));
		for (const id of routes) {
			const { key, target } = optionOf(id, "--route");
			const there = this.routeKeyFor(key);
			if (there === undefined) {
				this.edit.set(
					[
						ROGEN_BLOCK,
						"routes",
						lowercase ? DeclaredKeys.identityOf(key) : key,
					],
					target
				);
				continue;
			}
			if (this.routes[there] !== target)
				this.notes.push(
					`routes.${there} goes to ${String(this.routes[there])}, not to ${target}, so it stays as it is.`
				);
			else this.notes.push(`routes.${there} is there already.`);
		}
		for (const id of unroutes) {
			const { key, target } = optionOf(id, "--no-route");
			const there = this.routeKeyFor(key);
			if (there === undefined) {
				this.notes.push(`${key} is not a route of the config.`);
				continue;
			}
			if (this.routes[there] !== target)
				throw new UsageError(
					`routes.${there} goes to ${String(this.routes[there])}, not to the standard ${target}, so init leaves it as it is.`,
					`Edit it in ${this.edit.fileName} to remove it.`
				);
			this.edit.remove([ROGEN_BLOCK, "routes", there]);
		}
	}

	private changeUnmatched({ unmatched }: ChangeRequest): void {
		if (unmatched === undefined) return;
		this.needRoutes("--unmatched");
		const fallback = DeclaredKeys.FALLBACK_ROUTE;
		const there = fallback in this.routes;
		if (unmatched === "shared") {
			const target = new StartingRoutes(this.language).sharedTarget;
			if (this.routes[fallback] === target) return;
			if (there) {
				this.notes.push(
					`routes.* goes to ${String(this.routes[fallback])}, not to ${target}, so it stays as it is.`
				);
				return;
			}
			this.edit.set([ROGEN_BLOCK, "routes", fallback], target);
			return;
		}
		if (!there) return;
		if (Object.keys(this.routes).length === 1)
			throw new UsageError(
				"--unmatched leave has no route to apply to.",
				"Add a route with --route first, or keep the files going to the shared route."
			);
		this.edit.remove([ROGEN_BLOCK, "routes", fallback]);
	}

	private async changeSourcePaths({
		sourcePaths: added = [],
		unsourcePaths: removed = [],
	}: ChangeRequest): Promise<void> {
		if (added.length + removed.length === 0) return;
		const current = this.sourcePaths;
		const toAdd = added.map(normalizeDir);
		const toRemove = removed.map(normalizeDir);
		for (const entry of toRemove)
			if (!current.includes(entry))
				throw new UsageError(
					`${entry} is not a source path of ${this.edit.fileName}.`,
					`The source paths are ${joinedWithAnd(current)}.`
				);
		const next = [
			...current.filter((entry) => !toRemove.includes(entry)),
			...toAdd.filter((entry) => !current.includes(entry)),
		];
		if (next.length === 0)
			throw new UsageError(
				"A project needs at least one source path.",
				"Add the folder that replaces it with --source-path."
			);
		const problem = this.directory.sourcePathsProblem(next);
		if (problem) throw new UsageError(problem);
		const { compiler } = this.language;
		if (compiler && next.length > 1)
			throw new UsageError(
				this.language.copy.sourcePath?.severalProblem ??
					`${this.language.copy.label} compiles one folder.`
			);
		for (const entry of toRemove) {
			const files = await new CodeFinder(
				this.fileSystemService
			).codeFilesIn(path.join(this.directory.path, entry));
			if (files.length > 0)
				this.warnings.push(
					warningDiagnostic(
						"init.sourcePathRemoved",
						{ resource: this.edit.fileName },
						`${entry} is no longer a source path, so Rogen no longer builds ${files.length === 1 ? "this file" : `these ${files.length >= 50 ? "50 or more" : files.length} files`} in it: ${files.slice(0, 5).join(", ")}${files.length > 5 ? ", ..." : ""}.`
					)
				);
		}
		for (const entry of toAdd.filter((one) => !current.includes(one))) {
			this.edit.set(
				[ROGEN_BLOCK, "sourcePaths"],
				next,
				`added sourcePaths ${entry}`
			);
			this.directories.push(entry);
		}
		for (const entry of toRemove)
			this.edit.set(
				[ROGEN_BLOCK, "sourcePaths"],
				next,
				`removed sourcePaths ${entry}`
			);
	}

	private changeDarklua({ darklua }: ChangeRequest): void {
		if (darklua === undefined) return;
		throw new UsageError(
			"Darklua's second config file isn't something init writes yet.",
			'Write the file that sets "syncPath" to the folder Darklua writes yourself.'
		);
	}

	private changePackages({ packages }: ChangeRequest): void {
		if (packages === undefined || packages.length === 0) return;
		this.needRoutes("--package");
		const offered = [
			...this.directory.workspace.packageMounts(this.language),
			...this.language.offeredMounts(),
		];
		const mounted = mountedIn(this.edit.value.tree);
		for (const wanted of packages) {
			const mount = offered.find(
				(one) =>
					one.path ===
					oneOf(
						normalizeDir(wanted),
						offered.map(({ path: one }) => one),
						"a folder to mount",
						"--package"
					)
			)!;
			if (mounted.some((dir) => containsPosix(dir, mount.path))) {
				this.notes.push(`${mount.path} is mounted already.`);
				continue;
			}
			const node = {
				$path: mount.installed ? mount.path : { optional: mount.path },
			};
			const names = mount.landing.split("/");
			const label = `added tree.${names.join(".")}`;
			if (this.edit.valueAt(["tree"]) === undefined)
				this.edit.set(
					["tree"],
					{
						$className: "DataModel",
						...names.reduceRight<Record<string, unknown>>(
							(inner, name) => ({ [name]: inner }),
							node
						),
					},
					label
				);
			else this.edit.set(["tree", ...names], node, label);
		}
	}
}
