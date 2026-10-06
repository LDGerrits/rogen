import { dirnamePosix, joinPosix } from "../../base/path.js";
import { DeclaredKeys } from "../config/config.js";
import { Target } from "../roblox/roblox.js";
import { RojoFile, RojoScriptSuffix } from "../rojo/rojo.js";
import { InstanceMap } from "../rojo/rojo-project.js";
import { RouteMatch, VariantMatch } from "./build.js";
import {
	EntryRead,
	InstancelessFolder,
	NameReadings,
	SuffixSpan,
} from "./name-reader.js";
import { ScannedFile, ScannedRoot } from "./root-scanner.js";

/** A node one of the file's own folders becomes, with that folder relative to the root dir. */
export interface FolderNode {
	readonly instancePath: readonly string[];
	readonly dir: string;
}

export interface RoutedFile {
	readonly entry: ScannedFile;
	/** The governing route key, or `*`. */
	readonly route: string;
	readonly routeMatch: RouteMatch;
	/** The service, the target's folders, the file's own folders, then the instance name; an init script's ends at its folder's. */
	readonly instancePath: readonly string[];
	/** Routing, variant and invisible folders name no node, so they have none; a routing folder that an outer route outranks is an ordinary folder. */
	readonly folderNodes: readonly FolderNode[];
	/** The route keys that name the file but sit under the governing route, so they changed nothing. */
	readonly ignoredRoutes: readonly string[];
	/** Variant folders and suffixes are already out of `instancePath`; the variant stage decides what they mean. */
	readonly variants: readonly VariantMatch[];
	/** A `.server`/`.client` that a variant suffix follows, which Rojo won't read as a script class. */
	readonly buriedScriptSuffix?: RojoScriptSuffix;
	/** The `@key`s in its name and its folders' that an outer route outranks, which therefore stay in the names. */
	readonly ignoredAts: readonly IgnoredAt[];
	/** An init script, which is the nearest of its folders that becomes a node rather than an instance of its own. */
	readonly isInit: boolean;
	/** An init script placed where its folder becomes a node in another route; only a ModuleScript that no route of its own sends anywhere is. */
	readonly isCopy: boolean;
}

export interface IgnoredAt {
	readonly key: string;
	/** The folder that spells it, relative to the root dir; none for the file's own name. */
	readonly dir?: string;
}

/** An init script that no folder of its own becomes a node for, so it has no instance to be. */
export interface HomelessInit {
	readonly source: string;
	readonly variants: readonly VariantMatch[];
	/** The folder it sits in. */
	readonly folder: InstancelessFolder;
}

/** What the folders and markers above a file, then its own suffixes, claim for it; the outermost route wins. */
class Claims {
	route: { readonly key: string; readonly match: RouteMatch } | undefined;
	readonly ignoredRoutes: string[] = [];
	readonly ignoredAts: IgnoredAt[] = [];
	readonly variants: VariantMatch[] = [];

	/** Whether the route governs; a later one is ignored whole. */
	claimRoute(key: string, match: RouteMatch): boolean {
		if (this.route) {
			this.ignoredRoutes.push(key);
			return false;
		}
		this.route = { key, match };
		return true;
	}

	claimVariant(variant: VariantMatch): void {
		this.variants.push(variant);
	}
}

interface LeafReading {
	readonly name: string;
	readonly buriedScriptSuffix: RojoScriptSuffix | undefined;
	readonly isInit: boolean;
}

/** A file read up to its route: what claimed it, its folders and its name. */
interface Reading {
	readonly claims: Claims;
	readonly folders: readonly {
		readonly name: string;
		readonly dir: string;
	}[];
	readonly leaf: LeafReading;
}

/** An init ModuleScript that no route of its own sends anywhere, and where the fallback route placed it, if anywhere. */
interface Loose {
	readonly entry: ScannedFile;
	readonly reading: Reading;
	readonly placed: RoutedFile | undefined;
}

/** The route an init script's suffix gives the folder it sits in, by that folder relative to the root dir. */
type InitRoutes = ReadonlyMap<
	string,
	readonly { readonly key: string; readonly source: string }[]
>;

/** Finds each scanned file's governing route and instance path. */
export class Router {
	constructor(
		private readonly keys: DeclaredKeys,
		private readonly targets: ReadonlyMap<string, Target>,
		private readonly readings: NameReadings,
		/** Which declared variants are on, since only an init script that can be placed routes its folder. */
		private readonly variants: Readonly<Record<string, boolean>>,
		/** The script names that make a file its folder. */
		private readonly initNames: ReadonlySet<string>
	) {}

	/** Every file a route governs, in scan order, then the copies of init scripts; the sources of the files no route governs; and the init scripts with no folder to be. */
	route(roots: readonly ScannedRoot[]): {
		routed: RoutedFile[];
		unrouted: string[];
		homeless: HomelessInit[];
	} {
		const routed: RoutedFile[] = [];
		const unrouted: string[] = [];
		const homeless: HomelessInit[] = [];
		for (const root of roots) {
			const markers = root.markersByDir();
			const initRoutes = this.initRoutesOf(root);
			const fromRoot: RoutedFile[] = [];
			const loose: Loose[] = [];
			for (const entry of root.entries) {
				const reading = this.read(entry, markers, initRoutes);
				const placed = this.place(entry, reading);
				if (reading.leaf.isInit && reading.folders.length === 0) {
					if (placed)
						homeless.push({
							source: entry.source,
							variants: reading.claims.variants,
							folder: this.homeOf(entry),
						});
					else unrouted.push(entry.source);
					continue;
				}
				if (placed) fromRoot.push(placed);
				else unrouted.push(entry.source);
				if (
					reading.leaf.isInit &&
					reading.claims.route === undefined &&
					this.isModule(entry)
				)
					loose.push({ entry, reading, placed });
			}
			routed.push(...fromRoot, ...this.copies(loose, fromRoot));
		}
		return { routed, unrouted, homeless };
	}

	/** Why the folder an init script sits in names no node; every folder that names none has a reason. */
	private homeOf(entry: ScannedFile): InstancelessFolder {
		const folder = this.readings.instanceless(
			entry.rootDir,
			dirnamePosix(entry.relativePath)
		);
		if (!folder)
			throw new Error(
				`${entry.source} has no folder to be, but the folder it sits in can become one.`
			);
		return folder;
	}

	/** The routes each folder's init scripts give it; a script with a dormant variant can't be placed, so it gives none. */
	private initRoutesOf(root: ScannedRoot): InitRoutes {
		const routes = new Map<string, { key: string; source: string }[]>();
		for (const entry of root.entries) {
			const read = this.readings.entryAt(entry.source);
			if (!this.isInitRead(read)) continue;
			const spans = read.match.spans;
			if (
				spans.some(
					({ key }) => this.keys.isVariant(key) && !this.variants[key]
				)
			)
				continue;
			const dir = dirnamePosix(entry.relativePath);
			for (const { key } of spans)
				if (this.keys.routeKeys.has(key)) {
					const inDir = routes.get(dir) ?? [];
					inDir.push({ key, source: entry.source });
					routes.set(dir, inDir);
				}
		}
		return routes;
	}

	private read(
		entry: ScannedFile,
		markers: ReadonlyMap<string, string[]>,
		initRoutes: InitRoutes
	): Reading {
		const read = this.readings.entryAt(entry.source);
		const claims = new Claims();
		const folders = this.readFolders(
			entry,
			read,
			markers,
			initRoutes,
			claims
		);
		return { claims, folders, leaf: this.readLeaf(read, claims) };
	}

	private place(
		entry: ScannedFile,
		reading: Reading
	): RoutedFile | undefined {
		const { claims, folders, leaf } = reading;
		const route = claims.route?.key ?? DeclaredKeys.FALLBACK_ROUTE;
		const target = this.targets.get(route);
		if (!target) return undefined;

		const folderNodes: FolderNode[] = [];
		let parent: readonly string[] = target.instancePath;
		for (const { name: folderName, dir } of folders) {
			parent = [...parent, folderName];
			folderNodes.push({ instancePath: parent, dir });
		}
		return {
			entry,
			route,
			routeMatch: claims.route?.match ?? "fallback",
			instancePath: leaf.isInit ? parent : [...parent, leaf.name],
			folderNodes,
			ignoredRoutes: claims.ignoredRoutes,
			variants: claims.variants,
			buriedScriptSuffix: leaf.buriedScriptSuffix,
			ignoredAts: claims.ignoredAts,
			isInit: leaf.isInit,
			isCopy: false,
		};
	}

	/** A copied Script would run once per copy, so only a ModuleScript is copied. */
	private isModule(entry: ScannedFile): boolean {
		return this.readings.entryAt(entry.source).scriptSuffix === undefined;
	}

	/** An init ModuleScript no route sends anywhere is every node its folder becomes, so each of the others gets a copy of it. */
	private copies(
		loose: readonly Loose[],
		routed: readonly RoutedFile[]
	): RoutedFile[] {
		// An init script that can be placed is its own folder's node, so a copy doesn't take it.
		const inits = routed.filter(
			({ isInit, variants }) =>
				isInit &&
				variants.every(({ variant }) => this.variants[variant])
		);
		return loose.flatMap(({ entry, reading, placed }) => {
			const folder = reading.folders[reading.folders.length - 1].dir;
			const nodes = new InstanceMap<RoutedFile>();
			for (const init of inits) nodes.set(init.instancePath, init);
			if (placed) nodes.set(placed.instancePath, placed);
			const copies: RoutedFile[] = [];
			for (const file of routed) {
				const at = file.folderNodes.findIndex(
					({ dir }) => dir === folder
				);
				if (at < 0) continue;
				const { instancePath } = file.folderNodes[at];
				if (nodes.get(instancePath)) continue;
				const copy: RoutedFile = {
					entry,
					route: file.route,
					routeMatch: "copy",
					instancePath,
					folderNodes: file.folderNodes.slice(0, at + 1),
					ignoredRoutes: [],
					ignoredAts: [],
					variants: reading.claims.variants,
					buriedScriptSuffix: reading.leaf.buriedScriptSuffix,
					isInit: true,
					isCopy: true,
				};
				nodes.set(instancePath, copy);
				copies.push(copy);
			}
			return copies;
		});
	}

	/** Routing, variant and invisible folders and markers claim the file, then the route suffixes of the init scripts in each folder; every other folder, a `Name@key` routing folder and a routing folder an outer route outranks becomes a node. */
	private readFolders(
		entry: ScannedFile,
		read: EntryRead,
		markers: ReadonlyMap<string, string[]>,
		initRoutes: InitRoutes,
		claims: Claims
	): { readonly name: string; readonly dir: string }[] {
		const applyDirClaims = (dir: string) => {
			for (const fileName of markers.get(dir) ?? []) {
				const key = this.readings.markers.get(
					joinPosix(entry.rootDir, dir, fileName)
				)?.key;
				if (key === undefined) continue;
				if (this.keys.isVariant(key))
					claims.claimVariant({ variant: key, form: "marker" });
				else claims.claimRoute(key, "marker");
			}
			// An init script claims its own suffix as any file does.
			for (const { key, source } of initRoutes.get(dir) ?? [])
				if (source !== entry.source) claims.claimRoute(key, "init");
		};

		applyDirClaims("");
		const folders: { name: string; dir: string }[] = [];
		for (const folder of read.folders) {
			for (const variant of folder.variants)
				claims.claimVariant({ variant, form: "folder" });
			let governs = true;
			if (folder.route !== undefined) {
				governs = claims.claimRoute(folder.route, "folder");
				if (!governs && folder.at)
					claims.ignoredAts.push({
						key: folder.route,
						dir: folder.dir,
					});
			}
			const name = governs ? folder.keptName : folder.outrankedName;
			if (name !== undefined && !folder.invisible)
				folders.push({ name, dir: folder.dir });
			applyDirClaims(folder.dir);
		}
		return folders;
	}

	/** Reads the suffixes of a file into `claims` and returns its instance name. */
	private readLeaf(read: EntryRead, claims: Claims): LeafReading {
		const { kind, stem, match } = read;
		const variantSpans = match.spans.filter((span) =>
			this.keys.isVariant(span.key)
		);
		for (const span of variantSpans)
			claims.claimVariant(this.asVariantMatch(span));
		let routeSpan: SuffixSpan | undefined;
		for (const span of match.spans) {
			if (!this.keys.routeKeys.has(span.key)) continue;
			if (claims.claimRoute(span.key, "suffix")) routeSpan = span;
			else if (stem[span.start] === "@")
				claims.ignoredAts.push({ key: span.key });
		}

		const buriedScriptSuffix =
			kind === "script" &&
			variantSpans.length > 0 &&
			!RojoFile.scriptSuffixOf(stem)
				? RojoFile.scriptSuffixOf(this.stripSpans(stem, variantSpans))
				: undefined;
		const stripped = this.stripSpans(
			stem,
			routeSpan ? [...variantSpans, routeSpan] : variantSpans
		);
		return {
			name:
				kind === "script" ? RojoFile.scriptNameOf(stripped) : stripped,
			buriedScriptSuffix,
			isInit: this.isInitRead(read),
		};
	}

	/** Whether the file is an init script once every declared key is off its name, a route it doesn't govern too. */
	private isInitRead({ kind, stem, match }: EntryRead): boolean {
		return (
			kind === "script" &&
			this.initNames.has(
				RojoFile.scriptNameOf(this.stripSpans(stem, match.spans))
			)
		);
	}

	private asVariantMatch(span: SuffixSpan): VariantMatch {
		return { variant: span.key, form: "suffix" };
	}

	/** Keeps the stem whole rather than return an empty name. */
	private stripSpans(stem: string, spans: readonly SuffixSpan[]): string {
		const stripped = [...spans]
			.sort((a, b) => b.start - a.start)
			.reduce(
				(name, span) =>
					name.slice(0, span.start) +
					name.slice(span.start + span.length),
				stem
			);
		return stripped || stem;
	}
}
