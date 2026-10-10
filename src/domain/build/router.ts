import path from "path";
import { compareStrings, groupBy } from "../../base/collections.js";
import { dirnamePosix, joinPosix } from "../../base/path.js";
import { DeclaredKeys, ResolvedConfig } from "../config/config.js";
import { RojoFile, RojoFileKind, RojoScriptSuffix } from "../rojo/rojo.js";
import { instanceKey } from "../rojo/rojo-project.js";
import { RouteMatch, VariantMatch } from "./build.js";
import { NameReader, SuffixSpan } from "./name-reader.js";
import {
	EntryRead,
	FolderRead,
	InstancelessFolder,
	NameReadings,
} from "./name-readings.js";
import { ScannedFile, ScannedRoot } from "./root-scanner.js";

/** A node one of the file's own folders becomes, with that folder as an absolute POSIX path. */
export interface FolderNode {
	readonly instancePath: readonly string[];
	readonly folder: string;
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
	/** The route keys of bare routing folders above the file that the governing route outranks, unless a sign restating that route sits at or below them. */
	readonly outrankedFolderRoutes: readonly string[];
	/** Variant folders and suffixes are already out of `instancePath`; the variant stage decides what they mean. */
	readonly variants: readonly VariantMatch[];
	/** The instance each of `variants` gives an alternative of: the node of the folder or marker that carries it, or the file's own. */
	readonly variantNodes: readonly (readonly string[])[];
	/** A `.server`/`.client` that a variant suffix follows, which Rojo won't read as a script class. */
	readonly buriedScriptSuffix?: RojoScriptSuffix;
	/** The `@key`s in its name, its folders' and its markers that an outer route outranks and that don't restate it. */
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
}

/** A directory whose markers, an init script's route suffix among them, route its folder to more than one place. */
export interface MarkerClash {
	/** An absolute POSIX path. */
	readonly dir: string;
	/** The marker files and init scripts that route it, sorted. */
	readonly names: readonly string[];
	/** When only init scripts of variants route it apart from the rest, the folder each set of variants needs with its own marker, such as `mock/dev/@client`. */
	readonly variantFolders?: readonly string[];
}

/** A variant file that lands apart from the plain file beside it, which it would ship with rather than replace. */
export interface LandsElsewhere {
	readonly file: RoutedFile;
	readonly plain: RoutedFile;
}

/** An init script that no folder of its own becomes a node for, so it has no instance to be. */
export interface InitWithoutFolder {
	readonly source: string;
	/** The folder it sits in. */
	readonly folder: InstancelessFolder;
}

/** How many folders deep a directory relative to the root dir is. */
const depthOf = (dir: string) => (dir === "" ? 0 : dir.split("/").length);

/** A folder above a file that becomes a node, by its name and its folder relative to the root dir. */
interface ClaimedFolder {
	readonly name: string;
	readonly dir: string;
}

/** What the folders and markers above a file, then its own suffixes, claim for it; the outermost route wins. */
class Claims {
	route: { readonly key: string; readonly match: RouteMatch } | undefined;
	readonly ignoredAts: IgnoredAt[] = [];
	readonly variants: VariantMatch[] = [];
	/** For each of `variants`, the index of the node it claims among the folders that name one, the file's own last. */
	readonly variantLevels: number[] = [];
	/** The bare routing folders the governing route outranks, by how deep they are. */
	private readonly outrankedFolders: { key: string; depth: number }[] = [];
	/** The depth of the deepest sign that restates the governing route. */
	private restatedDepth = -1;

	/** The governing route key, or `*`. */
	get routeKey(): string {
		return this.route?.key ?? DeclaredKeys.FALLBACK_ROUTE;
	}

	/** Whether the route governs; a later one is ignored whole. */
	claimRoute(key: string, match: RouteMatch): boolean {
		if (this.route) return false;
		this.route = { key, match };
		return true;
	}

	/** The routes of the bare routing folders the governing route outranks that no sign restating it covers, at or below them. */
	get outrankedFolderRoutes(): string[] {
		return this.outrankedFolders
			.filter(({ depth }) => depth > this.restatedDepth)
			.map(({ key }) => key);
	}

	/** An `@key` the governing route outranks, at `depth`. One that restates it agrees, so it comes off the name and covers the bare routing folders at or above it; any other is reported at `at`. Returns whether it restates. */
	outrankSigned(key: string, depth: number, at?: IgnoredAt): boolean {
		if (this.route?.key === key) {
			this.restatedDepth = Math.max(this.restatedDepth, depth);
			return true;
		}
		if (at) this.ignoredAts.push(at);
		return false;
	}

	/** A bare name of a route the governing one outranks, which may only be a name. */
	outrankBare(key: string, depth: number): void {
		if (this.route?.key !== key) this.outrankedFolders.push({ key, depth });
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
	readonly folders: readonly ClaimedFolder[];
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

/** What the markers and init scripts of a root dir's folders offer to claim, by folder relative to the root dir. */
interface DirClaims {
	readonly markers: ReadonlyMap<string, string[]>;
	readonly initRoutes: InitRoutes;
}

/** The route an init script's suffix gives the folder it sits in, by that folder relative to the root dir, whether it's spelled `@key`, and the script's variants. */
type InitRoutes = ReadonlyMap<string, readonly InitRoute[]>;

interface InitRoute {
	readonly key: string;
	readonly source: string;
	readonly at: boolean;
	/** In the order the name spells them. */
	readonly variants: readonly string[];
}

/** What routing found in the scanned files. */
export interface Routing {
	readonly routed: RoutedFile[];
	readonly toCopy: InitToCopy[];
	readonly unrouted: string[];
	readonly withoutFolder: InitWithoutFolder[];
	readonly hoistedInits: HoistedInit[];
	readonly markerClashes: MarkerClash[];
	readonly landsElsewhere: LandsElsewhere[];
}

/** Finds each scanned file's governing route and instance path. */
export class Router {
	private readonly keys: DeclaredKeys;

	constructor(
		/** Its routes and keys; never which variants are on, so a file routes the same in every build. */
		private readonly config: ResolvedConfig,
		private readonly readings: NameReadings,
		/** The script names that make a file its folder. */
		private readonly initNames: ReadonlySet<string>
	) {
		this.keys = config.keys;
	}

	/** Every file a route governs, in scan order; the init scripts to copy; the sources of the files no route governs; the init scripts with no folder to be; the directories whose markers disagree; and the variant files that land apart from the plain file beside them. */
	route(roots: readonly ScannedRoot[]): Routing {
		const routing: Routing = {
			routed: [],
			toCopy: [],
			unrouted: [],
			withoutFolder: [],
			hoistedInits: [],
			markerClashes: [],
			landsElsewhere: [],
		};
		for (const root of roots) {
			const dirs: DirClaims = {
				markers: root.markersByDir(),
				initRoutes: this.initRoutesOf(root),
			};
			routing.markerClashes.push(...this.markerClashesOf(root, dirs));
			const before = routing.routed.length;
			for (const entry of root.entries)
				this.routeEntry(entry, dirs, routing);
			routing.landsElsewhere.push(
				...this.landingElsewhere(routing.routed.slice(before))
			);
		}
		return routing;
	}

	/** A variant file is an alternative of the plain file beside it, so it has to land where one of those does. */
	private landingElsewhere(routed: readonly RoutedFile[]): LandsElsewhere[] {
		const found: LandsElsewhere[] = [];
		for (const beside of groupBy(routed, (file) =>
			this.besideKeyOf(file)
		).values()) {
			const plain = beside.filter((file) => file.variants.length === 0);
			const landings = new Set(
				plain.map(({ instancePath }) => instanceKey(instancePath))
			);
			if (plain.length > 0)
				for (const file of beside)
					if (!landings.has(instanceKey(file.instancePath)))
						found.push({ file, plain: plain[0] });
		}
		return found;
	}

	/** Where a file sits with its variants off: its directory without variant folders or the variants on its folders, and its instance name, or none for an init script. */
	private besideKeyOf({ entry, instancePath, init }: RoutedFile): string {
		const dirs = this.readings
			.entryAt(entry.source)
			.folders.flatMap((folder) =>
				folder.variants.length > 0 &&
				folder.keptName === undefined &&
				folder.route === undefined
					? []
					: [
							`${folder.invisible ? "()" : ""}${folder.hoisted ? "^" : ""}${folder.outrankedName}`,
						]
			);
		const name = init ? "" : instancePath[instancePath.length - 1];
		return `${joinPosix(entry.rootDir, ...dirs)}\n${name}`;
	}

	/** Adds `entry` to `routing` as what it turns out to be: hoisted, an init script without a folder, or a routed or unrouted file. */
	private routeEntry(
		entry: ScannedFile,
		dirs: DirClaims,
		routing: Routing
	): void {
		const claimed = this.claim(entry, dirs);
		if (claimed.leaf.isInit && claimed.leaf.hoisted) {
			routing.hoistedInits.push({ source: entry.source });
			return;
		}
		if (claimed.leaf.isInit && claimed.folders.length === 0) {
			if (this.config.routes.has(claimed.claims.routeKey))
				routing.withoutFolder.push({
					source: entry.source,
					folder: this.instancelessFolderOf(entry),
				});
			else routing.unrouted.push(entry.source);
			return;
		}
		const placed = this.place(entry, claimed);
		if (placed) routing.routed.push(placed);
		else routing.unrouted.push(entry.source);
		if (this.isCopied(claimed))
			routing.toCopy.push({
				entry,
				variants: claimed.claims.variants,
				buriedScriptSuffix: claimed.leaf.buriedScriptSuffix,
				init: this.initFolders(entry, claimed.folders),
				placed,
			});
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
		{ markers, initRoutes }: DirClaims
	): MarkerClash[] {
		const clashes: MarkerClash[] = [];
		for (const dir of new Set([...markers.keys(), ...initRoutes.keys()])) {
			const claims = [
				...(markers.get(dir) ?? []).flatMap((fileName) => {
					const key = this.markerKeyAt(root.rootDir, dir, fileName);
					return key !== undefined && this.keys.isRoute(key)
						? [{ key, name: fileName, variants: [] }]
						: [];
				}),
				...(initRoutes.get(dir) ?? []).map(
					({ key, source, variants }) => ({
						key,
						name: path.posix.basename(source),
						variants,
					})
				),
			];
			if (new Set(claims.map(({ key }) => key)).size > 1)
				clashes.push({
					dir: joinPosix(root.rootDir, dir),
					names: claims.map(({ name }) => name).sort(compareStrings),
					...Router.variantFoldersOf(claims),
				});
		}
		return clashes;
	}

	/** Markers and plain init scripts that agree leave the folder one route, so only the variants' init scripts route it apart; each set of variants then needs its own folder, unless two scripts of one set disagree too. */
	private static variantFoldersOf(
		claims: readonly Pick<InitRoute, "key" | "variants">[]
	): Pick<MarkerClash, "variantFolders"> {
		const plainKeys = new Set(
			claims
				.filter(({ variants }) => variants.length === 0)
				.map(({ key }) => key)
		);
		const bySet = groupBy(
			claims.filter(({ variants }) => variants.length > 0),
			({ variants }) => variants.join("/")
		);
		const agree = [...bySet.values()].every(
			(set) => new Set(set.map(({ key }) => key)).size === 1
		);
		if (plainKeys.size > 1 || !agree) return {};
		return {
			variantFolders: [...bySet]
				.filter(([, [{ key }]]) => !plainKeys.has(key))
				.map(([folder, [{ key }]]) => `${folder}/@${key}`)
				.sort(compareStrings),
		};
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

	/** The routes each folder's init scripts give it, whichever variants are on, so turning one on never moves the files beside it. */
	private initRoutesOf(root: ScannedRoot): InitRoutes {
		const routes = new Map<string, InitRoute[]>();
		for (const entry of root.entries) {
			const read = this.readings.entryAt(entry.source);
			if (!this.isInitEntry(read)) continue;
			const { stem, match } = read;
			// Only the last `@key` of a name routes; the ones before it are outranked.
			const governing = match.spans.find(({ key }) =>
				this.keys.isRoute(key)
			);
			if (!governing) continue;
			const dir = dirnamePosix(entry.relativePath);
			routes.set(dir, [
				...(routes.get(dir) ?? []),
				{
					key: governing.key,
					source: entry.source,
					at: stem[governing.start] === "@",
					variants: match.spans
						.filter(({ key }) => this.keys.isVariant(key))
						.map(({ key }) => key)
						.reverse(),
				},
			]);
		}
		return routes;
	}

	private claim(entry: ScannedFile, dirs: DirClaims): ClaimedPath {
		const read = this.readings.entryAt(entry.source);
		const claims = new Claims();
		const { folders, hoistAt } = this.claimFolders(
			entry,
			read,
			dirs,
			claims
		);
		const leaf = this.claimLeaf(read, claims, folders.length);
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
			folderNodes.push({
				instancePath: parent,
				folder: joinPosix(entry.rootDir, dir),
			});
		}
		const instancePath = leaf.isInit ? parent : [...parent, leaf.name];
		return {
			entry,
			route,
			routeMatch: claims.route?.match ?? "fallback",
			instancePath,
			folderNodes,
			outrankedFolderRoutes: claims.outrankedFolderRoutes,
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
		dirs: DirClaims,
		claims: Claims
	): {
		readonly folders: readonly ClaimedFolder[];
		/** Where the folders below the innermost `^` folder start; none without one. */
		readonly hoistAt: number | undefined;
	} {
		const claimDirectory = (dir: string, level: number) =>
			this.claimDirectory(entry, dir, level, dirs, claims);
		claimDirectory("", 0);
		const folders: ClaimedFolder[] = [];
		let hoistAt: number | undefined;
		for (const folder of read.folders) {
			if (folder.hoisted) hoistAt = folders.length;
			for (const variant of folder.variants)
				claims.claimVariant(
					{ variant, form: "folder" },
					folders.length
				);
			const routes = this.claimFolderRoute(folder, claims);
			const name = routes ? folder.keptName : folder.outrankedName;
			const named = name !== undefined && !folder.invisible;
			if (named) folders.push({ name, dir: folder.dir });
			claimDirectory(
				folder.dir,
				named ? folders.length - 1 : folders.length
			);
		}
		return { folders, hoistAt };
	}

	/** What the markers of `dir`, and the route suffixes of the init scripts in it, claim for `entry` at `level`. */
	private claimDirectory(
		entry: ScannedFile,
		dir: string,
		level: number,
		{ markers, initRoutes }: DirClaims,
		claims: Claims
	): void {
		const depth = depthOf(dir);
		for (const fileName of markers.get(dir) ?? []) {
			const key = this.markerKeyAt(entry.rootDir, dir, fileName);
			if (key === undefined) continue;
			if (this.keys.isVariant(key))
				claims.claimVariant({ variant: key, form: "marker" }, level);
			else if (!claims.claimRoute(key, "marker"))
				claims.outrankSigned(key, depth, {
					key,
					dir,
					marker: fileName,
				});
		}
		// An init script claims its own suffix as any file does, and reports its own `@`; a Rojo suffix like `init.server` is bare, as a folder's name is.
		for (const { key, source, at } of initRoutes.get(dir) ?? []) {
			if (source === entry.source || claims.claimRoute(key, "init"))
				continue;
			if (at) claims.outrankSigned(key, depth);
			else claims.outrankBare(key, depth);
		}
	}

	/** Claims the route a folder's name spells, if it does; returns whether the folder routes, rather than being outranked and an ordinary folder. */
	private claimFolderRoute(folder: FolderRead, claims: Claims): boolean {
		if (folder.route === undefined) return true;
		const { route, dir } = folder;
		const depth = depthOf(dir);
		let routes = claims.claimRoute(route, "folder");
		if (!routes && folder.at)
			routes = claims.outrankSigned(route, depth, { key: route, dir });
		else if (!routes) claims.outrankBare(route, depth);
		for (const key of folder.innerRoutes)
			claims.outrankSigned(key, depth, { key, dir });
		return routes;
	}

	/** Reads the suffixes of a file into `claims`, each claiming the file's node at `level`, and returns its instance name. */
	private claimLeaf(
		read: EntryRead,
		claims: Claims,
		level: number
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
			const { key, start } = span;
			if (!this.keys.isRoute(key)) continue;
			const routes =
				claims.claimRoute(key, "suffix") ||
				(stem[start] === "@" &&
					claims.outrankSigned(key, Infinity, { key }));
			if (routes) routeSpan ??= span;
		}

		const buriedScriptSuffix =
			kind === "script" &&
			variantSpans.length > 0 &&
			!RojoFile.scriptSuffixOf(stem)
				? RojoFile.scriptSuffixOf(
						NameReader.withoutSpans(stem, variantSpans)
					)
				: undefined;
		const stripped = NameReader.withoutSpans(stem, [
			...variantSpans,
			...match.spans.filter((span) => span.key === routeSpan?.key),
		]);
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
				this.leafName(kind, NameReader.withoutSpans(stem, match.spans))
					.name
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
