import path from "path";
import { isSameJson } from "../../base/objects.js";
import { containsPosix, toPosix } from "../../base/path.js";
import { FileLocation, PlacedLocation } from "../write/write-service.js";
import { ResolvedConfig, compiledPathOf } from "../config/resolved-config.js";
import { configStem } from "../config/config.js";

export type Style = "folder" | "suffix" | "marker" | "pattern" | "fallback";

export type NewStyle = "folder" | "suffix";

export interface Donor {
	readonly dir: string;
	readonly style: Style;
	readonly route: string;
	readonly sourcePath: string;
}

/**
 * The file that keeps an empty folder, which Rojo writes for an empty Folder.
 */
export const GITKEEP = ".gitkeep";

const isPlaced = (location: FileLocation): location is PlacedLocation =>
	location.status === "placed";

export class SyncbackLayout {
	readonly placed: readonly PlacedLocation[];
	private readonly roots: readonly string[];
	private readonly shared: ReadonlySet<string>;
	private features?: readonly (
		| { readonly folder: string; readonly instance: readonly string[] }
		| undefined
	)[];

	constructor(
		readonly config: ResolvedConfig,
		locations: readonly FileLocation[],
		others: readonly ResolvedConfig[] = []
	) {
		this.placed = locations.filter(isPlaced);
		this.roots = config.sourcePaths.map(toPosix);
		this.shared = new Set(
			others.flatMap((other) => other.sourcePaths.map(toPosix))
		);
	}

	synced(dir: string): string {
		return toPosix(compiledPathOf(this.config, dir));
	}

	get sourcePaths(): readonly string[] {
		return this.roots;
	}

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

	sourcePathHolding(folder: string): string | undefined {
		const holding = this.roots.filter((root) => {
			const dir = path.posix.join(root, folder);
			return this.placed.some((file) => containsPosix(dir, file.source));
		});
		return holding.length === 1 ? holding[0] : undefined;
	}

	donorsAt(node: readonly string[]): Donor[] {
		const donors: Donor[] = [];
		for (const file of this.placed) {
			if (
				this.skipsItsFolders(file) ||
				SyncbackLayout.makesItsFolder(file)
			)
				continue;
			if (!isSameJson(file.instancePath.slice(0, -1), node)) continue;
			const sourcePath = this.rootOf(file.source);
			if (!sourcePath) continue;
			donors.push({
				dir: path.posix.dirname(file.source),
				style: file.routeMatch,
				route: file.route,
				sourcePath,
			});
		}
		return donors;
	}

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

	static makesItsFolder(file: PlacedLocation): boolean {
		return (
			file.folderNodes?.some(({ instancePath }) =>
				isSameJson(instancePath, file.instancePath)
			) === true
		);
	}

	initLeavesItsFolder(node: readonly string[]): boolean {
		const maker = this.fileMaking(node);
		return (
			maker !== undefined &&
			SyncbackLayout.makesItsFolder(maker) &&
			maker.routeMatch === "suffix"
		);
	}

	fileMaking(node: readonly string[]): PlacedLocation | undefined {
		return this.placed.find((file) => isSameJson(file.instancePath, node));
	}

	featureMaking(
		node: readonly string[]
	): { folder: string; instances: (readonly string[])[] } | undefined {
		if (this.fileMaking(node)) return undefined;
		this.features ??= this.placed.map((file) => this.featureOf(file));
		const { features } = this;
		const folders = new Set(
			features.flatMap((feature) =>
				feature && isSameJson(feature.instance, node)
					? [feature.folder]
					: []
			)
		);
		if (folders.size !== 1) return undefined;
		const [folder] = folders;
		const instances: (readonly string[])[] = [];
		for (const file of this.placed)
			for (const made of file.folderNodes ?? [])
				if (
					made.folder === folder &&
					!instances.some((known) =>
						isSameJson(known, made.instancePath)
					)
				)
					instances.push(made.instancePath);
		return { folder, instances };
	}

	folderNameFor(route: string): string {
		const names = new Map<string, number>();
		for (const file of this.placed) {
			const folder = SyncbackLayout.routingFolderOf(file);
			if (file.route !== route || folder === undefined) continue;
			const name = path.posix.basename(folder);
			names.set(name, (names.get(name) ?? 0) + 1);
		}
		let most: [string, number] = [route, 0];
		for (const entry of names) if (entry[1] > most[1]) most = entry;
		return most[0];
	}

	private rootOf(source: string): string | undefined {
		return this.roots.find((root) => containsPosix(root, source));
	}

	private featureOf(
		file: PlacedLocation
	): { folder: string; instance: readonly string[] } | undefined {
		const { routedBy } = file;
		if (
			routedBy === undefined ||
			(file.routeMatch !== "folder" && file.routeMatch !== "suffix")
		)
			return undefined;
		const made = file.folderNodes
			?.filter(
				({ folder }) =>
					folder !== routedBy && containsPosix(folder, routedBy)
			)
			.at(-1);
		return made && { folder: made.folder, instance: made.instancePath };
	}

	private static routingFolderOf(file: PlacedLocation): string | undefined {
		const { routedBy } = file;
		return file.routeMatch === "folder" &&
			routedBy !== undefined &&
			!(file.folderNodes ?? []).some(({ folder }) => folder === routedBy)
			? routedBy
			: undefined;
	}

	private skipsItsFolders(file: PlacedLocation): boolean {
		return file.hoisted === true && file.folderNodes === undefined;
	}
}
