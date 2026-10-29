import path from "path";
import { dirnamePosix, joinPosix } from "../../base/path.js";
import { DeclaredKeys } from "../config/declared-keys.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { RojoScriptSuffix } from "../rojo/rojo.js";
import { RouteMatch } from "./write.js";
import { DirClaims, RootClaims } from "./dir-claims.js";
import { InstanceName, SuffixSpan } from "./instance-name.js";
import {
	EntryReading,
	FolderReading,
	InstancelessFolder,
	NameReadings,
} from "./name-readings.js";
import { ScannedFile, ScannedRoot } from "./root-scanner.js";

interface FolderNode {
	readonly instancePath: readonly string[];
	readonly folder: string;
}

export interface RoutedFile {
	readonly entry: ScannedFile;
	readonly route: string;
	readonly routeMatch: RouteMatch;
	readonly instancePath: readonly string[];
	readonly folderNodes: readonly FolderNode[];
	readonly outrankedFolderRoutes: readonly string[];
	readonly ignoredAts: readonly IgnoredAt[];
	readonly init?: InitFolders;
	readonly hoisted?: boolean;
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
	route: { readonly key: string; readonly match: RouteMatch } | undefined;
	readonly ignoredAts: IgnoredAt[] = [];
	private readonly outrankedFolders: { key: string; depth: number }[] = [];
	private restatedDepth = -1;

	get routeKey(): string {
		return this.route?.key ?? DeclaredKeys.FALLBACK_ROUTE;
	}

	claim(key: string, match: RouteMatch): Standing {
		if (this.route) return this.standingOf(key);
		this.route = { key, match };
		return "governs";
	}

	/** A `@` signal: losing it is reported as an ignored `@` when `at` says where. */
	signed(
		key: string,
		match: RouteMatch,
		depth: number,
		at?: IgnoredAt
	): Standing {
		const standing = this.claim(key, match);
		this.recordSigned(standing, depth, at);
		return standing;
	}

	/** A signal that carries no `@`: losing it outranks the folders it would have routed. */
	unsigned(key: string, match: RouteMatch, depth: number): Standing {
		const standing = this.claim(key, match);
		if (standing === "outranked")
			this.outrankedFolders.push({ key, depth });
		return standing;
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
	"instancePath" | "folderNodes"
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
}

export class Router {
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
			folder,
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
			? { folder, ...placed }
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
			entry.source,
			read.folders,
			dirs,
			claims
		);
		const leaf = this.claimLeaf(read, claims);
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
		};
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
			instancePath,
			folderNodes,
			outrankedFolderRoutes: claims.outrankedFolderRoutes,
			ignoredAts: claims.ignoredAts,
			init: leaf.isInit ? this.initFolders(entry, folders) : undefined,
			...(claimed.hoisted && { hoisted: true }),
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
		source: string,
		readings: readonly FolderReading[],
		dirs: DirClaims,
		claims: Claims
	): {
		readonly folders: readonly ClaimedFolder[];
		readonly hoistAt: number | undefined;
	} {
		const claimDirectory = (dir: string) =>
			this.claimDirectory(source, dir, dirs, claims);
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
		}
		return { folders, hoistAt };
	}

	private claimDirectory(
		source: string,
		dir: string,
		dirs: DirClaims,
		claims: Claims
	): void {
		const depth = depthOf(dir);
		for (const { fileName, key } of dirs.markersAt(dir)) {
			claims.signed(key, "marker", depth, { key, dir, marker: fileName });
		}
		for (const { key, source: init, at } of dirs.initRoutesAt(dir)) {
			if (init === source) continue;
			if (at) claims.signed(key, "init", depth);
			else claims.unsigned(key, "init", depth);
		}
	}

	private claimFolderRoute(folder: FolderReading, claims: Claims): boolean {
		if (folder.route === undefined) return true;
		const { route, dir } = folder;
		const depth = depthOf(dir);
		const standing = folder.at
			? claims.signed(route, "folder", depth, { key: route, dir })
			: claims.unsigned(route, "folder", depth);
		for (const key of folder.innerRoutes)
			claims.outrankSigned(key, depth, { key, dir });
		return speaksForRoute(standing, folder.at);
	}

	private claimLeaf(read: EntryReading, claims: Claims): LeafName {
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
				? claims.signed(key, "suffix", Infinity, { key })
				: claims.claim(key, "suffix");
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
