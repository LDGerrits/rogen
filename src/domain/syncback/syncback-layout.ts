import path from "path";
import { containsPosix, toPosix } from "../../base/path.js";
import { FileLocation, PlacedLocation } from "../write/write-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { configStem } from "../config/config.js";

/** How a placed file was routed, which a new file beside it repeats. */
export type Style = "folder" | "suffix" | "marker" | "fallback";

/** The styles a new instance can be written in when no file beside it shows one. */
export type NewStyle = "folder" | "suffix";

/** A file placed directly under a node, and how: what a new instance there is written like. */
export interface Donor {
	readonly dir: string;
	readonly style: Style;
	/** The route key it was placed by. */
	readonly route: string;
	/** What the file's name spells after `@`, when it does. */
	readonly spelled?: string;
	/** Absolute POSIX path of the source path it lies in. */
	readonly sourcePath: string;
}

const AT_KEY = /@([A-Za-z][A-Za-z0-9]*)(?=\.|$)/;

const isPlaced = (location: FileLocation): location is PlacedLocation =>
	location.status === "placed";

/** What the placed files of one project say about where their instances live on disk. */
export class SyncbackLayout {
	private readonly placed: readonly PlacedLocation[];
	private readonly roots: readonly string[];
	private readonly keys: ResolvedConfig["keys"];
	private readonly shared: ReadonlySet<string>;
	private features?: readonly (
		| { readonly folder: string; readonly instance: readonly string[] }
		| undefined
	)[];

	constructor(
		readonly config: ResolvedConfig,
		locations: readonly FileLocation[],
		/** The other configs of the project, whose source paths are shared code where this config lists them too. */
		others: readonly ResolvedConfig[] = []
	) {
		this.placed = locations.filter(isPlaced);
		this.roots = config.sourcePaths.map(toPosix);
		this.keys = config.keys;
		this.shared = new Set(
			others.flatMap((other) => other.sourcePaths.map(toPosix))
		);
	}

	/** Where Rojo reads the source folder `dir` from: under the compiled path when a tool writes the files there. */
	synced(dir: string): string {
		const { compiledPath, commonRoot } = this.config;
		if (compiledPath === undefined || commonRoot === undefined) return dir;
		return path.posix.join(
			toPosix(compiledPath),
			path.posix.relative(toPosix(commonRoot), dir)
		);
	}

	get sourcePaths(): readonly string[] {
		return this.roots;
	}

	/** The source path a new feature with nothing beside it goes in: the only one, else the one named for the place, else the one inside the config's folder, else the one no other config of the project lists; none when that gives no one answer. */
	get ownSourcePath(): string | undefined {
		if (this.roots.length === 1) return this.roots[0];
		const names = [configStem(this.config.file), this.config.projectName];
		const named = this.roots.filter((root) =>
			names.includes(path.posix.basename(root))
		);
		if (named.length === 1) return named[0];
		const dir = toPosix(this.config.projectDir);
		const inside = this.roots.filter((root) => containsPosix(dir, root));
		if (inside.length === 1) return inside[0];
		const own = this.roots.filter((root) => !this.shared.has(root));
		return own.length === 1 ? own[0] : undefined;
	}

	/** The one source path whose folder `folder`, relative to it, holds a placed file; none when no source path or several do. */
	sourcePathHolding(folder: string): string | undefined {
		const holding = this.roots.filter((root) => {
			const dir = path.posix.join(root, folder);
			return this.placed.some((file) => containsPosix(dir, file.source));
		});
		return holding.length === 1 ? holding[0] : undefined;
	}

	/** The files placed directly under `node`, each as the donor of the layout a new sibling is written in. */
	donorsAt(node: readonly string[]): Donor[] {
		const donors: Donor[] = [];
		for (const file of this.placed) {
			if (file.routeMatch === "init" || file.routeMatch === "copy")
				continue;
			if (!SyncbackLayout.sameNode(file.instancePath.slice(0, -1), node))
				continue;
			const sourcePath = this.rootOf(file.source);
			if (!sourcePath) continue;
			donors.push({
				dir: path.posix.dirname(file.source),
				style: file.routeMatch,
				route: file.route,
				...(file.routeMatch === "suffix" && {
					spelled:
						AT_KEY.exec(path.posix.basename(file.source))?.[1] ??
						file.route,
				}),
				sourcePath,
			});
		}
		return donors;
	}

	/** The style most files placed by `route` are written in, or most files of the project with no `route`; none when as many are in each, or none has one. */
	styleOf(route?: string): NewStyle | undefined {
		let folder = 0;
		let suffix = 0;
		for (const file of this.placed) {
			if (route !== undefined && file.route !== route) continue;
			if (file.routeMatch === "folder") folder++;
			else if (file.routeMatch === "suffix") suffix++;
		}
		return folder > suffix
			? "folder"
			: suffix > folder
				? "suffix"
				: undefined;
	}

	/** How the project's names spell `route` after an `@`; with none, the key in the letter case the names of other routes use. */
	spellingOf(route: string): string {
		let lowered = false;
		for (const file of this.placed) {
			if (file.routeMatch !== "suffix") continue;
			const spelled = AT_KEY.exec(path.posix.basename(file.source))?.[1];
			if (!spelled) continue;
			if (file.route === route) return spelled;
			lowered ||=
				spelled !== file.route && spelled === file.route.toLowerCase();
		}
		return lowered ? route.toLowerCase() : route;
	}

	/** The placed file that is the instance `node` itself, such as an init file making a folder. */
	fileMaking(node: readonly string[]): PlacedLocation | undefined {
		return this.placed.find((file) =>
			SyncbackLayout.sameNode(file.instancePath, node)
		);
	}

	/** The feature folder whose routing makes `node`, with every instance it makes, as its `init.meta.json` applies to each; none when `node` is not such an instance, such as one a script makes, or when its files say more than one folder. */
	featureMaking(
		node: readonly string[]
	): { folder: string; instances: (readonly string[])[] } | undefined {
		if (this.fileMaking(node)) return undefined;
		this.features ??= this.placed.map((file) => this.featureOf(file));
		const { features } = this;
		const folders = new Set(
			features.flatMap((feature) =>
				feature && SyncbackLayout.sameNode(feature.instance, node)
					? [feature.folder]
					: []
			)
		);
		if (folders.size !== 1) return undefined;
		const [folder] = folders;
		const instances: (readonly string[])[] = [];
		for (const feature of features)
			if (
				feature?.folder === folder &&
				!instances.some((known) =>
					SyncbackLayout.sameNode(known, feature.instance)
				)
			)
				instances.push(feature.instance);
		const inFeature = this.placed.every(
			(file) =>
				!containsPosix(folder, file.source) ||
				instances.some((instance) =>
					instance.every((name, at) => file.instancePath[at] === name)
				)
		);
		return inFeature ? { folder, instances } : undefined;
	}

	/** The routing folder name used for `route` in this project, else the key itself. */
	folderNameFor(route: string): string {
		for (const file of this.placed) {
			if (file.route !== route || file.routeMatch !== "folder") continue;
			const governing = this.governingDir(file);
			if (governing) return path.posix.basename(governing);
		}
		return route;
	}

	private static sameNode(a: readonly string[], b: readonly string[]) {
		return a.length === b.length && a.every((name, at) => name === b[at]);
	}

	private rootOf(source: string): string | undefined {
		return this.roots.find((root) => containsPosix(root, source));
	}

	/** The feature folder a file is in and the instance that folder is on the file's side: the folder holding the routing folder, or the name, that spells the file's route. */
	private featureOf(
		file: PlacedLocation
	): { folder: string; instance: readonly string[] } | undefined {
		const root = this.rootOf(file.source);
		if (!root) return undefined;
		const segments = path.posix.relative(root, file.source).split("/");
		const spelling = (segment: string, at: number) =>
			at < segments.length - 1
				? this.keys.resolve(segment) === file.route
				: false;
		const marked = (segment: string) => {
			const key = AT_KEY.exec(segment)?.[1];
			return key !== undefined && this.keys.resolve(key) === file.route;
		};
		let anchor: number;
		let below: string[];
		if (file.routeMatch === "folder") {
			anchor = segments.findIndex(spelling);
			below = segments.slice(anchor + 1);
		} else if (file.routeMatch === "suffix") {
			anchor = segments.findIndex(marked);
			below = segments.slice(anchor);
		} else return undefined;
		if (anchor < 1) return undefined;
		const isInit = segments[segments.length - 1].startsWith("init.");
		const depth = below.length - 1 + (isInit ? 0 : 1);
		if (depth < 1 || depth >= file.instancePath.length) return undefined;
		return {
			folder: path.posix.join(root, ...segments.slice(0, anchor)),
			instance: file.instancePath.slice(0, -depth),
		};
	}

	/** The first folder from the source path down that spells the file's route, as the router meets it. */
	private governingDir(file: PlacedLocation): string | undefined {
		const root = this.rootOf(file.source);
		if (!root) return undefined;
		const segments = path.posix
			.relative(root, path.posix.dirname(file.source))
			.split("/")
			.filter((segment) => segment !== "");
		for (const [at, segment] of segments.entries())
			if (this.keys.resolve(segment) === file.route)
				return path.posix.join(root, ...segments.slice(0, at + 1));
		return undefined;
	}
}
