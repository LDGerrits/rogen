import path from "path";
import { dirnamePosix, joinPosix } from "../../base/path.js";
import { DeclaredKeys } from "../config/declared-keys.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { PatternMatch } from "../config/route-patterns.js";
import { RojoScriptSuffix } from "../rojo/rojo.js";
import { FolderNode, RouteMatch } from "./write.js";
import { DirClaims, RootClaims } from "./dir-claims.js";
import { InstanceName, SuffixSpan } from "./instance-name.js";
import {
	EntryReading,
	FolderReading,
	InstancelessFolder,
	NameReadings,
} from "./name-readings.js";
import { ScannedFile, ScannedRoot } from "./root-scanner.js";

export interface RoutedFile {
	readonly entry: ScannedFile;
	readonly route: string;
	readonly routeMatch: RouteMatch;
	/** Absolute POSIX path of the folder or file whose name took the route, or of the folder a marker sits in; none for `*`. */
	readonly routedBy?: string;
	readonly instancePath: readonly string[];
	readonly folderNodes: readonly FolderNode[];
	readonly outrankedFolderRoutes: readonly string[];
	readonly ignoredAts: readonly IgnoredAt[];
	readonly init?: InitFolders;
	readonly hoisted?: boolean;
	/** The patterns that match with equal weight and different targets, which leave the file to `*`, and the folder or file whose name they match. */
	readonly patternClash?: PatternClash;
}

export interface PatternClash {
	readonly keys: readonly string[];
	/** Absolute POSIX path of the folder or file whose name the patterns match. */
	readonly at: string;
}

interface InitFolders {
	readonly becomes: string;
	readonly sitsIn: string;
}

interface IgnoredAt {
	readonly key: string;
	readonly dir?: string;
	readonly marker?: string;
}

/** An init script written `^init`: the script is its folder, so only the folder can take the `^`. */
export interface HoistedInit {
	readonly source: string;
}

/** An init script that no folder of its own becomes a node for, so it has no instance to be. */
export interface InitWithoutFolder {
	readonly source: string;
	readonly folder: InstancelessFolder;
}

const depthOf = (dir: string) => (dir === "" ? 0 : dir.split("/").length);

interface ClaimedFolder {
	readonly name: string;
	readonly dir: string;
}

/** Where a path's signal for a route stands: it took the route, repeats the one that governs, or lost to it. */
type Standing = "governs" | "restates" | "outranked";

const speaksForRoute = (standing: Standing, signed: boolean) =>
	standing === "governs" || (signed && standing === "restates");

class Claims {
	route:
		| {
				readonly key: string;
				readonly match: RouteMatch;
				/** The folder or file, relative to the source path, whose name took it. */
				readonly at: string;
		  }
		| undefined;
	readonly ignoredAts: IgnoredAt[] = [];
	private readonly outrankedFolders: { key: string; depth: number }[] = [];
	private restatedDepth = -1;

	get routeKey(): string {
		return this.route?.key ?? DeclaredKeys.FALLBACK_ROUTE;
	}

	claim(key: string, match: RouteMatch, at: string): Standing {
		if (this.route) return this.standingOf(key);
		this.route = { key, match, at };
		return "governs";
	}

	/** A `@` signal: losing it is reported as an ignored `@` when `at` says where. */
	signed(
		key: string,
		match: RouteMatch,
		by: string,
		depth: number,
		at?: IgnoredAt
	): Standing {
		const standing = this.claim(key, match, by);
		this.recordSigned(standing, depth, at);
		return standing;
	}

	/** A signal that carries no `@`: losing it outranks the folders it would have routed. */
	unsigned(
		key: string,
		match: RouteMatch,
		by: string,
		depth: number
	): Standing {
		const standing = this.claim(key, match, by);
		if (standing === "outranked")
			this.outrankedFolders.push({ key, depth });
		return standing;
	}

	/** A folder named for `key` in another letter case under the route: an ordinary folder that the route outranks, as it outranks one spelled as the key. */
	outrankName(key: string, depth: number): void {
		this.outrankedFolders.push({ key, depth });
	}

	/** A `@` signal that cannot take the route itself, as a folder's inner routes cannot. */
	outrankSigned(key: string, depth: number, at: IgnoredAt): void {
		this.recordSigned(this.standingOf(key), depth, at);
	}

	get outrankedFolderRoutes(): string[] {
		return this.outrankedFolders
			.filter(({ depth }) => depth > this.restatedDepth)
			.map(({ key }) => key);
	}

	private standingOf(key: string): "restates" | "outranked" {
		return this.route?.key === key ? "restates" : "outranked";
	}

	private recordSigned(standing: Standing, depth: number, at?: IgnoredAt) {
		if (standing === "restates")
			this.restatedDepth = Math.max(this.restatedDepth, depth);
		else if (standing === "outranked" && at) this.ignoredAts.push(at);
	}
}

interface LeafName {
	readonly name: string;
	readonly hoisted: boolean;
	readonly scriptSuffix: RojoScriptSuffix | undefined;
	readonly isInit: boolean;
	/** The name of the folder an init file becomes, when not the folder's own: a nested project's `name`. */
	readonly folderName?: string;
}

interface ClaimedPath {
	readonly claims: Claims;
	readonly patternClash?: PatternClash;
	readonly folders: readonly ClaimedFolder[];
	readonly leaf: LeafName;
	readonly hoisted: boolean;
	readonly dropped: number;
}

/** An init ModuleScript that no route of its own sends anywhere: it is every node its folder becomes. */
export interface InitToCopy extends Pick<RoutedFile, "entry"> {
	readonly init: InitFolders;
	readonly placed: RoutedFile | undefined;
}

/** A folder that holds nothing Rojo makes an instance from, at the node a file in it would sit in. */
export interface RoutedFolder extends Pick<
	RoutedFile,
	"instancePath" | "folderNodes" | "route" | "hoisted"
> {
	/** Absolute, POSIX-style. */
	readonly folder: string;
}

export interface Routing {
	readonly routed: RoutedFile[];
	readonly emptyFolders: RoutedFolder[];
	readonly toCopy: InitToCopy[];
	readonly unrouted: string[];
	readonly withoutFolder: InitWithoutFolder[];
	readonly hoistedInits: HoistedInit[];
	/** The folders named for a route in another letter case that an outer route governs, so their name places nothing; absolute, POSIX-style. */
	readonly governedNearMisses: ReadonlySet<string>;
}

export class Router {
	private readonly governedNearMisses = new Set<string>();

	constructor(
		private readonly config: ResolvedConfig,
		private readonly readings: NameReadings
	) {}

	/** Every file a route governs, in scan order; the empty folders it governs; the init scripts to copy; the sources of the files no route governs; the init scripts with no folder to be; and the init scripts written `^init`. */
	route(roots: readonly ScannedRoot[], claims: RootClaims): Routing {
		const routing: Routing = {
			routed: [],
			emptyFolders: [],
			toCopy: [],
			unrouted: [],
			withoutFolder: [],
			hoistedInits: [],
			governedNearMisses: this.governedNearMisses,
		};
		for (const root of roots) {
			const dirs = claims.of(root);
			for (const entry of root.entries)
				this.routeEntry(entry, dirs, routing);
			for (const dir of root.emptyDirs) {
				const folder = this.routeEmptyFolder(root, dir, dirs);
				if (folder) routing.emptyFolders.push(folder);
			}
		}
		return routing;
	}

	private routeEmptyFolder(
		root: ScannedRoot,
		dir: string,
		dirs: DirClaims
	): RoutedFolder | undefined {
		const claims = new Claims();
		const folder = joinPosix(root.sourcePath, dir);
		const { folders, hoistAt } = this.claimFolders(
			root.sourcePath,
			this.readings.foldersDownTo(root.sourcePath, dir),
			dirs,
			claims
		);
		const placed = this.placeFolders(
			root.sourcePath,
			folders.slice(hoistAt ?? 0),
			claims
		);
		return placed && placed.folderNodes.length > 0
			? {
					folder,
					route: claims.routeKey,
					...placed,
					...(hoistAt !== undefined && { hoisted: true }),
				}
			: undefined;
	}

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
				init: this.initFolders(entry, claimed.folders),
				placed,
			});
	}

	private instancelessFolderOf(entry: ScannedFile): InstancelessFolder {
		const folder = this.readings.instanceless(
			entry.sourcePath,
			dirnamePosix(entry.relativePath)
		);
		if (!folder)
			throw new Error(
				`${entry.source} has no folder to be, but the folder it sits in can become one.`
			);
		return folder;
	}

	private claim(entry: ScannedFile, dirs: DirClaims): ClaimedPath {
		const read = this.readings.entryReading(entry.source);
		const claims = new Claims();
		const { folders, hoistAt } = this.claimFolders(
			entry.sourcePath,
			read.folders,
			dirs,
			claims
		);
		const leaf = this.claimLeaf(read, claims, entry.relativePath);
		const pattern = claims.route
			? undefined
			: this.patternOf(entry, leaf.isInit);
		if (pattern?.match.kind === "routed")
			claims.claim(pattern.match.key, "pattern", entry.relativePath);
		const hoistsLeaf = leaf.hoisted && !leaf.isInit;
		const dropped = hoistsLeaf ? folders.length : (hoistAt ?? 0);
		const kept = folders.slice(dropped);
		const last = kept.length - 1;
		return {
			claims,
			folders:
				leaf.folderName === undefined || last < 0
					? kept
					: [
							...kept.slice(0, last),
							{ ...kept[last], name: leaf.folderName },
						],
			leaf,
			hoisted: hoistsLeaf || hoistAt !== undefined,
			dropped,
			...(pattern?.match.kind === "clash" && {
				patternClash: { keys: pattern.match.keys, at: pattern.at },
			}),
		};
	}

	/** The pattern a file's name, or the name of the instance it makes, matches. An init script is its folder, which no pattern matches, so it routes with the folder's other files. */
	private patternOf(
		entry: ScannedFile,
		isInit: boolean
	): { readonly match: PatternMatch; readonly at: string } | undefined {
		if (isInit) return undefined;
		const match = this.config.patterns.match(
			...[path.posix.basename(entry.source), entry.file.instanceName].map(
				(name) => name.replace(/^\^/, "")
			)
		);
		return match ? { match, at: entry.source } : undefined;
	}

	private place(
		entry: ScannedFile,
		claimed: ClaimedPath
	): RoutedFile | undefined {
		const { claims, folders, leaf } = claimed;
		const placed = this.placeFolders(entry.sourcePath, folders, claims);
		if (!placed) return undefined;

		const { instancePath: parent, folderNodes } = placed;
		const instancePath = leaf.isInit ? parent : [...parent, leaf.name];
		return {
			entry,
			route: claims.routeKey,
			routeMatch: claims.route?.match ?? "fallback",
			...(claims.route && {
				routedBy: joinPosix(entry.sourcePath, claims.route.at),
			}),
			instancePath,
			folderNodes,
			outrankedFolderRoutes: claims.outrankedFolderRoutes,
			ignoredAts: claims.ignoredAts,
			init: leaf.isInit ? this.initFolders(entry, folders) : undefined,
			...(claimed.hoisted && { hoisted: true }),
			...(claimed.patternClash && { patternClash: claimed.patternClash }),
		};
	}

	/** The nodes `folders` become under the route `claims` names, and the node a file in the last sits in; none when no route is declared for it. */
	private placeFolders(
		sourcePath: string,
		folders: readonly ClaimedFolder[],
		claims: Claims
	): Pick<RoutedFile, "instancePath" | "folderNodes"> | undefined {
		const target = this.config.routes.get(claims.routeKey);
		if (!target) return undefined;

		const folderNodes: FolderNode[] = [];
		let instancePath: readonly string[] = target.instancePath;
		for (const { name, dir } of folders) {
			instancePath = [...instancePath, name];
			folderNodes.push({
				instancePath,
				folder: joinPosix(sourcePath, dir),
			});
		}
		return { instancePath, folderNodes };
	}

	private initFolders(
		entry: ScannedFile,
		folders: ClaimedPath["folders"]
	): InitFolders {
		return {
			becomes: joinPosix(
				entry.sourcePath,
				folders[folders.length - 1].dir
			),
			sitsIn: path.posix.dirname(entry.source),
		};
	}

	private isCopied({ claims, leaf }: ClaimedPath): boolean {
		return (
			leaf.isInit &&
			claims.route === undefined &&
			leaf.scriptSuffix === undefined
		);
	}

	private claimFolders(
		sourcePath: string,
		readings: readonly FolderReading[],
		dirs: DirClaims,
		claims: Claims
	): {
		readonly folders: readonly ClaimedFolder[];
		readonly hoistAt: number | undefined;
	} {
		const claimDirectory = (dir: string) =>
			this.claimDirectory(dir, dirs, claims);
		claimDirectory("");
		const folders: ClaimedFolder[] = [];
		let hoistAt: number | undefined;
		for (const folder of readings) {
			if (folder.hoisted) hoistAt = folders.length;
			const routes = this.claimFolderRoute(folder, claims);
			const name = routes ? folder.keptName : folder.outrankedName;
			const named = name !== undefined && !folder.invisible;
			if (named) folders.push({ name, dir: folder.dir });
			claimDirectory(folder.dir);
			// A folder named for a route in another case is an ordinary folder where a route above it, or a marker in it, routes its files.
			if (folder.nearMissKey !== undefined && claims.route) {
				claims.outrankName(folder.nearMissKey, depthOf(folder.dir));
				this.governedNearMisses.add(joinPosix(sourcePath, folder.dir));
			}
		}
		return { folders, hoistAt };
	}

	private claimDirectory(dir: string, dirs: DirClaims, claims: Claims): void {
		const depth = depthOf(dir);
		for (const { fileName, key } of dirs.markersAt(dir)) {
			claims.signed(key, "marker", dir, depth, {
				key,
				dir,
				marker: fileName,
			});
		}
	}

	private claimFolderRoute(folder: FolderReading, claims: Claims): boolean {
		if (folder.route === undefined) return true;
		const { route, dir } = folder;
		const depth = depthOf(dir);
		const standing = folder.at
			? claims.signed(route, "folder", dir, depth, { key: route, dir })
			: claims.unsigned(route, "folder", dir, depth);
		for (const key of folder.innerRoutes)
			claims.outrankSigned(key, depth, { key, dir });
		return speaksForRoute(standing, folder.at);
	}

	private claimLeaf(
		read: EntryReading,
		claims: Claims,
		relativePath: string
	): LeafName {
		const {
			kind,
			stem,
			match,
			scriptSuffix,
			isInit,
			nameCutByRule,
			projectName,
		} = read;
		let routeSpan: SuffixSpan | undefined;
		for (const span of match.spans) {
			const { key, start } = span;
			const signed = stem[start] === "@";
			const standing = signed
				? claims.signed(key, "suffix", relativePath, Infinity, { key })
				: claims.claim(key, "suffix", relativePath);
			if (speaksForRoute(standing, signed)) routeSpan ??= span;
		}

		const stripped = InstanceName.withoutSpans(
			stem,
			match.spans.filter((span) => span.key === routeSpan?.key)
		);
		const { name, hoisted } = InstanceName.leafName(
			kind,
			stripped,
			nameCutByRule
		);
		return {
			name: isInit ? name : (projectName ?? name),
			hoisted,
			scriptSuffix,
			isInit,
			...(isInit &&
				projectName !== undefined && { folderName: projectName }),
		};
	}
}
