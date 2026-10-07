import path from "path";
import { compareStrings } from "../../base/collections.js";
import { dirnamePosix, joinPosix } from "../../base/path.js";
import { DeclaredKeys, ResolvedConfig } from "../config/config.js";
import { RojoFile, RojoFileKind, RojoScriptSuffix } from "../rojo/rojo.js";
import { RouteMatch, VariantMatch } from "./build.js";
import {
	EntryRead,
	InstancelessFolder,
	NameReader,
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
	/** The instance each of `variants` gives an alternative of: the node of the folder or marker that carries it, or the file's own. */
	readonly variantNodes: readonly (readonly string[])[];
	/** A `.server`/`.client` that a variant suffix follows, which Rojo won't read as a script class. */
	readonly buriedScriptSuffix?: RojoScriptSuffix;
	/** The `@key`s in its name and its folders' that an outer route outranks, which therefore stay in the names. */
	readonly ignoredAts: readonly IgnoredAt[];
	/** Set for an init script, which is the nearest of its folders that becomes a node rather than an instance of its own. */
	readonly init?: InitFolders;
	/** A `^` on its name or a folder's dropped the folders above that name. */
	readonly hoisted?: boolean;
}

/** The two folders of an init script, which differ when a variant folder sits between them. */
export interface InitFolders {
	/** The nearest of its folders that becomes a node, which the script is; an absolute POSIX path. */
	readonly becomes: string;
	/** The directory it sits in, which Rojo reads it through; an absolute POSIX path. */
	readonly sitsIn: string;
}

export interface IgnoredAt {
	readonly key: string;
	/** The folder that spells it, or holds the marker that does, relative to the root dir; none for the file's own name. */
	readonly dir?: string;
	/** The marker file that spells it. */
	readonly marker?: string;
}

/** An init script written `^init`: the script is its folder, so only the folder can take the `^`. */
export interface HoistedInit {
	readonly source: string;
	readonly variants: readonly VariantMatch[];
}

/** A directory whose markers, an init script's route suffix among them, route its folder to more than one place. */
export interface MarkerClash {
	/** An absolute POSIX path. */
	readonly dir: string;
	/** The marker files and init scripts that route it, sorted. */
	readonly names: readonly string[];
}

/** An init script that no folder of its own becomes a node for, so it has no instance to be. */
export interface InitWithoutFolder {
	readonly source: string;
	readonly variants: readonly VariantMatch[];
	/** The folder it sits in. */
	readonly folder: InstancelessFolder;
}

/** What the folders and markers above a file, then its own suffixes, claim for it; the outermost route wins. */
class Claims {
	/** `dir` is set for a marker or init script, which claim at their directory's level. */
	route:
		| {
				readonly key: string;
				readonly match: RouteMatch;
				readonly dir?: string;
		  }
		| undefined;
	readonly ignoredRoutes: string[] = [];
	readonly ignoredAts: IgnoredAt[] = [];
	readonly variants: VariantMatch[] = [];
	/** For each of `variants`, the index of the node it claims among the folders that name one, the file's own last. */
	readonly variantLevels: number[] = [];

	/** The governing route key, or `*`. */
	get routeKey(): string {
		return this.route?.key ?? DeclaredKeys.FALLBACK_ROUTE;
	}

	/** Whether the route governs; a later one is ignored whole. */
	claimRoute(key: string, match: RouteMatch, dir?: string): boolean {
		if (this.route) {
			this.ignoredRoutes.push(key);
			return false;
		}
		this.route = { key, match, ...(dir !== undefined && { dir }) };
		return true;
	}

	/** The same route claimed again at the level that governs is harmless, so it isn't reported. */
	repeats(key: string, dir: string): boolean {
		return this.route?.key === key && this.route.dir === dir;
	}

	claimVariant(variant: VariantMatch, level: number): void {
		this.variants.push(variant);
		this.variantLevels.push(level);
	}
}

/** The file's own name, as Rojo reads it once the suffixes its route and variants claimed are off, and its `^`. */
interface LeafName {
	readonly name: string;
	readonly hoisted: boolean;
	readonly scriptSuffix: RojoScriptSuffix | undefined;
	readonly buriedScriptSuffix: RojoScriptSuffix | undefined;
	readonly isInit: boolean;
}

/** A file's path, claimed up to its route: what claimed it, the folders that name its nodes, and its own name. */
interface ClaimedPath {
	readonly claims: Claims;
	/** Only those below the innermost `^`, which drops the ones above it. */
	readonly folders: readonly {
		readonly name: string;
		readonly dir: string;
	}[];
	readonly leaf: LeafName;
	readonly hoisted: boolean;
	/** How many folders above `folders` the `^` dropped. */
	readonly dropped: number;
}

/** An init ModuleScript that no route of its own sends anywhere, which is every node its folder becomes; and where the fallback route placed it, if anywhere. */
export interface InitToCopy extends Pick<
	RoutedFile,
	"entry" | "variants" | "buriedScriptSuffix"
> {
	readonly init: InitFolders;
	readonly placed: RoutedFile | undefined;
}

/** The route an init script's suffix gives the folder it sits in, by that folder relative to the root dir. */
type InitRoutes = ReadonlyMap<
	string,
	readonly { readonly key: string; readonly source: string }[]
>;

/** Finds each scanned file's governing route and instance path. */
export class Router {
	private readonly keys: DeclaredKeys;

	constructor(
		/** Its routes, and which declared variants are on, since only an init script that can be placed routes its folder. */
		private readonly config: ResolvedConfig,
		private readonly readings: NameReadings,
		/** The script names that make a file its folder. */
		private readonly initNames: ReadonlySet<string>
	) {
		this.keys = config.keys;
	}

	/** Every file a route governs, in scan order; the init scripts to copy; the sources of the files no route governs; the init scripts with no folder to be; and the directories whose markers disagree. */
	route(roots: readonly ScannedRoot[]): {
		routed: RoutedFile[];
		toCopy: InitToCopy[];
		unrouted: string[];
		withoutFolder: InitWithoutFolder[];
		hoistedInits: HoistedInit[];
		markerClashes: MarkerClash[];
	} {
		const routed: RoutedFile[] = [];
		const toCopy: InitToCopy[] = [];
		const unrouted: string[] = [];
		const withoutFolder: InitWithoutFolder[] = [];
		const hoistedInits: HoistedInit[] = [];
		const markerClashes: MarkerClash[] = [];
		for (const root of roots) {
			const markers = root.markersByDir();
			const initRoutes = this.initRoutesOf(root);
			markerClashes.push(
				...this.markerClashesOf(root, markers, initRoutes)
			);
			for (const entry of root.entries) {
				const claimed = this.claim(entry, markers, initRoutes);
				if (claimed.leaf.isInit && claimed.leaf.hoisted) {
					const { variants } = claimed.claims;
					hoistedInits.push({ source: entry.source, variants });
					// A dormant one is pruned like any other file, so `where` still accounts for it.
					if (this.config.allVariantsOn(variants)) continue;
				}
				if (claimed.leaf.isInit && claimed.folders.length === 0) {
					if (this.config.routes.has(claimed.claims.routeKey))
						withoutFolder.push({
							source: entry.source,
							variants: claimed.claims.variants,
							folder: this.instancelessFolderOf(entry),
						});
					else unrouted.push(entry.source);
					continue;
				}
				const placed = this.place(entry, claimed);
				if (placed) routed.push(placed);
				else unrouted.push(entry.source);
				if (this.isCopied(claimed))
					toCopy.push({
						entry,
						variants: claimed.claims.variants,
						buriedScriptSuffix: claimed.leaf.buriedScriptSuffix,
						init: this.initFolders(entry, claimed.folders),
						placed,
					});
			}
		}
		return {
			routed,
			toCopy,
			unrouted,
			withoutFolder,
			hoistedInits,
			markerClashes,
		};
	}

	/** The declared key the marker `fileName` in `dir` spells, if any. */
	private markerKeyAt(
		rootDir: string,
		dir: string,
		fileName: string
	): string | undefined {
		return this.readings.markers.get(joinPosix(rootDir, dir, fileName))
			?.key;
	}

	/** Markers in one directory all sit at one level, so no order could choose between two routes; claiming them in scan order would pick one silently. */
	private markerClashesOf(
		root: ScannedRoot,
		markers: ReadonlyMap<string, string[]>,
		initRoutes: InitRoutes
	): MarkerClash[] {
		const clashes: MarkerClash[] = [];
		for (const dir of new Set([...markers.keys(), ...initRoutes.keys()])) {
			const claims = [
				...(markers.get(dir) ?? []).flatMap((fileName) => {
					const key = this.markerKeyAt(root.rootDir, dir, fileName);
					return key !== undefined && !this.keys.isVariant(key)
						? [{ key, name: fileName }]
						: [];
				}),
				...(initRoutes.get(dir) ?? []).map(({ key, source }) => ({
					key,
					name: path.posix.basename(source),
				})),
			];
			if (new Set(claims.map(({ key }) => key)).size > 1)
				clashes.push({
					dir: joinPosix(root.rootDir, dir),
					names: claims.map(({ name }) => name).sort(compareStrings),
				});
		}
		return clashes;
	}

	/** Why the folder an init script sits in names no node; every folder that names none has a reason. */
	private instancelessFolderOf(entry: ScannedFile): InstancelessFolder {
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

	/** The routes each folder's init scripts give it; a script with a dormant variant can't be placed, and a plain one an active variant's replaces isn't, so neither gives one. */
	private initRoutesOf(root: ScannedRoot): InitRoutes {
		const placeable = new Map<
			string,
			{ spans: readonly SuffixSpan[]; source: string; varied: boolean }[]
		>();
		for (const entry of root.entries) {
			const read = this.readings.entryAt(entry.source);
			if (!this.isInitEntry(read)) continue;
			const spans = read.match.spans;
			const variants = spans
				.filter(({ key }) => this.keys.isVariant(key))
				.map((span) => this.asVariantMatch(span));
			if (!this.config.allVariantsOn(variants)) continue;
			const dir = dirnamePosix(entry.relativePath);
			placeable.set(dir, [
				...(placeable.get(dir) ?? []),
				{ spans, source: entry.source, varied: variants.length > 0 },
			]);
		}
		const routes = new Map<string, { key: string; source: string }[]>();
		for (const [dir, inits] of placeable) {
			const varied = inits.some((init) => init.varied);
			routes.set(
				dir,
				inits
					.filter((init) => init.varied || !varied)
					.flatMap(({ spans, source }) =>
						spans
							.filter(({ key }) => this.keys.routeKeys.has(key))
							.map(({ key }) => ({ key, source }))
					)
			);
		}
		return routes;
	}

	private claim(
		entry: ScannedFile,
		markers: ReadonlyMap<string, string[]>,
		initRoutes: InitRoutes
	): ClaimedPath {
		const read = this.readings.entryAt(entry.source);
		const claims = new Claims();
		const { folders, hoistAt } = this.claimFolders(
			entry,
			read,
			markers,
			initRoutes,
			claims
		);
		const leaf = this.claimLeaf(
			read,
			claims,
			folders.length,
			dirnamePosix(entry.relativePath)
		);
		// An init script is its folder, so its own `^` hoists nothing.
		const hoistsLeaf = leaf.hoisted && !leaf.isInit;
		const dropped = hoistsLeaf ? folders.length : (hoistAt ?? 0);
		return {
			claims,
			folders: folders.slice(dropped),
			leaf,
			hoisted: hoistsLeaf || hoistAt !== undefined,
			dropped,
		};
	}

	private place(
		entry: ScannedFile,
		claimed: ClaimedPath
	): RoutedFile | undefined {
		const { claims, folders, leaf } = claimed;
		const route = claims.routeKey;
		const target = this.config.routes.get(route);
		if (!target) return undefined;

		const folderNodes: FolderNode[] = [];
		let parent: readonly string[] = target.instancePath;
		for (const { name: folderName, dir } of folders) {
			parent = [...parent, folderName];
			folderNodes.push({ instancePath: parent, dir });
		}
		const instancePath = leaf.isInit ? parent : [...parent, leaf.name];
		return {
			entry,
			route,
			routeMatch: claims.route?.match ?? "fallback",
			instancePath,
			folderNodes,
			ignoredRoutes: claims.ignoredRoutes,
			variants: claims.variants,
			variantNodes: claims.variantLevels.map(
				(level) =>
					folderNodes[Math.max(0, level - claimed.dropped)]
						?.instancePath ?? instancePath
			),
			buriedScriptSuffix: leaf.buriedScriptSuffix,
			ignoredAts: claims.ignoredAts,
			init: leaf.isInit ? this.initFolders(entry, folders) : undefined,
			...(claimed.hoisted && { hoisted: true }),
		};
	}

	private initFolders(
		entry: ScannedFile,
		folders: ClaimedPath["folders"]
	): InitFolders {
		return {
			becomes: joinPosix(entry.rootDir, folders[folders.length - 1].dir),
			sitsIn: path.posix.dirname(entry.source),
		};
	}

	/** A copied Script would run once per copy, so only a ModuleScript is copied. */
	private isCopied({ claims, leaf }: ClaimedPath): boolean {
		return (
			leaf.isInit &&
			claims.route === undefined &&
			leaf.scriptSuffix === undefined
		);
	}

	/** Routing, variant and invisible folders and markers claim the file, then the route suffixes of the init scripts in each folder; every other folder, a `Name@key` routing folder and a routing folder an outer route outranks becomes a node. */
	private claimFolders(
		entry: ScannedFile,
		read: EntryRead,
		markers: ReadonlyMap<string, string[]>,
		initRoutes: InitRoutes,
		claims: Claims
	): {
		readonly folders: readonly {
			readonly name: string;
			readonly dir: string;
		}[];
		/** Where the folders below the innermost `^` folder start; none without one. */
		readonly hoistAt: number | undefined;
	} {
		const applyDirClaims = (dir: string, level: number) => {
			for (const fileName of markers.get(dir) ?? []) {
				const key = this.markerKeyAt(entry.rootDir, dir, fileName);
				if (key === undefined) continue;
				if (this.keys.isVariant(key))
					claims.claimVariant(
						{ variant: key, form: "marker" },
						level
					);
				else if (
					!claims.claimRoute(key, "marker", dir) &&
					!claims.repeats(key, dir)
				)
					claims.ignoredAts.push({ key, dir, marker: fileName });
			}
			// An init script claims its own suffix as any file does.
			for (const { key, source } of initRoutes.get(dir) ?? [])
				if (source !== entry.source) claims.claimRoute(key, "init", dir);
		};

		applyDirClaims("", 0);
		const folders: { name: string; dir: string }[] = [];
		let hoistAt: number | undefined;
		for (const folder of read.folders) {
			if (folder.hoisted) hoistAt = folders.length;
			for (const variant of folder.variants)
				claims.claimVariant(
					{ variant, form: "folder" },
					folders.length
				);
			let governs = true;
			if (folder.route !== undefined) {
				governs = claims.claimRoute(folder.route, "folder");
				if (!governs && folder.at)
					claims.ignoredAts.push({
						key: folder.route,
						dir: folder.dir,
					});
				for (const key of folder.innerRoutes) {
					claims.claimRoute(key, "folder");
					claims.ignoredAts.push({ key, dir: folder.dir });
				}
			}
			const name = governs ? folder.keptName : folder.outrankedName;
			const named = name !== undefined && !folder.invisible;
			if (named) folders.push({ name, dir: folder.dir });
			applyDirClaims(
				folder.dir,
				named ? folders.length - 1 : folders.length
			);
		}
		return { folders, hoistAt };
	}

	/** Reads the suffixes of a file into `claims`, each claiming the file's node at `level`, and returns its instance name. */
	private claimLeaf(
		read: EntryRead,
		claims: Claims,
		level: number,
		dir: string
	): LeafName {
		const { kind, stem, match, scriptSuffix } = read;
		const variantSpans = match.spans.filter((span) =>
			this.keys.isVariant(span.key)
		);
		for (const span of variantSpans)
			claims.claimVariant(this.asVariantMatch(span), level);
		const isInit = this.isInitEntry(read);
		let routeSpan: SuffixSpan | undefined;
		for (const span of match.spans) {
			if (!this.keys.routeKeys.has(span.key)) continue;
			if (claims.claimRoute(span.key, "suffix")) routeSpan = span;
			else if (
				stem[span.start] === "@" &&
				!(isInit && claims.repeats(span.key, dir))
			)
				claims.ignoredAts.push({ key: span.key });
		}

		const buriedScriptSuffix =
			kind === "script" &&
			variantSpans.length > 0 &&
			!RojoFile.scriptSuffixOf(stem)
				? RojoFile.scriptSuffixOf(NameReader.withoutSpans(stem, variantSpans))
				: undefined;
		const stripped = NameReader.withoutSpans(
			stem,
			routeSpan ? [...variantSpans, routeSpan] : variantSpans
		);
		const { name, hoisted } = this.leafName(kind, stripped);
		return {
			name,
			hoisted,
			scriptSuffix,
			buriedScriptSuffix,
			isInit,
		};
	}

	/** Whether the file is an init script once every declared key is off its name, a route it doesn't govern too. */
	private isInitEntry({ kind, stem, match }: EntryRead): boolean {
		return (
			kind === "script" &&
			this.initNames.has(
				this.leafName(kind, NameReader.withoutSpans(stem, match.spans)).name
			)
		);
	}

	/** The name Rojo gives a stem with its keys off, then with its `^` off. */
	private leafName(
		kind: RojoFileKind,
		stripped: string
	): { readonly name: string; readonly hoisted: boolean } {
		return NameReader.unhoisted(
			kind === "script" ? RojoFile.scriptNameOf(stripped) : stripped
		);
	}

	private asVariantMatch(span: SuffixSpan): VariantMatch {
		return { variant: span.key, form: "suffix" };
	}
}
