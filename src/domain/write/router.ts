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
	readonly routedBy?: string;
	readonly instancePath: readonly string[];
	readonly folderNodes: readonly FolderNode[];
	readonly outrankedFolderRoutes: readonly string[];
	readonly ignoredAts: readonly IgnoredAt[];
	readonly init?: InitFolders;
	readonly hoisted?: boolean;
	readonly patternClash?: PatternClash;
}

export interface PatternClash {
	readonly keys: readonly string[];
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

export interface HoistedInit {
	readonly source: string;
}

export interface InitWithoutFolder {
	readonly source: string;
	readonly folder: InstancelessFolder;
}

const depthOf = (dir: string) => (dir === "" ? 0 : dir.split("/").length);

interface ClaimedFolder {
	readonly name: string;
	readonly dir: string;
}

type Standing = "governs" | "restates" | "outranked";

const speaksForRoute = (standing: Standing, signed: boolean) =>
	standing === "governs" || (signed && standing === "restates");

class Claims {
	route:
		| {
				readonly key: string;
				readonly match: RouteMatch;
				readonly at: string;
		  }
		| undefined;
	readonly ignoredAts: IgnoredAt[] = [];
	private readonly outrankedFolders: { key: string; depth: number }[] = [];
	private signedDepth = -1;

	get routeKey(): string {
		return this.route?.key ?? DeclaredKeys.FALLBACK_ROUTE;
	}

	claim(key: string, match: RouteMatch, at: string): Standing {
		if (this.route) return this.standingOf(key);
		this.route = { key, match, at };
		return "governs";
	}

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

	outrankName(key: string, depth: number): void {
		this.outrankedFolders.push({ key, depth });
	}

	outrankSigned(key: string, depth: number, at: IgnoredAt): void {
		this.recordSigned(this.standingOf(key), depth, at);
	}

	get outrankedFolderRoutes(): string[] {
		return this.outrankedFolders
			.filter(({ depth }) => depth > this.signedDepth)
			.map(({ key }) => key);
	}

	private standingOf(key: string): "restates" | "outranked" {
		return this.route?.key === key ? "restates" : "outranked";
	}

	private recordSigned(standing: Standing, depth: number, at?: IgnoredAt) {
		if (speaksForRoute(standing, true))
			this.signedDepth = Math.max(this.signedDepth, depth);
		else if (standing === "outranked" && at) this.ignoredAts.push(at);
	}
}

interface LeafName {
	readonly name: string;
	readonly hoisted: boolean;
	readonly scriptSuffix: RojoScriptSuffix | undefined;
	readonly isInit: boolean;
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

export interface RoutedFolder extends Pick<
	RoutedFile,
	"instancePath" | "folderNodes" | "route" | "hoisted"
> {
	readonly folder: string;
}

export interface Routing {
	readonly routed: RoutedFile[];
	readonly emptyFolders: RoutedFolder[];
	readonly unrouted: string[];
	readonly withoutFolder: InitWithoutFolder[];
	readonly hoistedInits: HoistedInit[];
	readonly governedNearMisses: ReadonlySet<string>;
}

export class Router {
	private readonly governedNearMisses = new Set<string>();

	constructor(
		private readonly config: ResolvedConfig,
		private readonly readings: NameReadings
	) {}

	route(roots: readonly ScannedRoot[], claims: RootClaims): Routing {
		const routing: Routing = {
			routed: [],
			emptyFolders: [],
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
		if (
			claimed.leaf.isInit &&
			claimed.leaf.hoisted &&
			claimed.folders.at(-1)?.dir === dirnamePosix(entry.relativePath)
		) {
			routing.hoistedInits.push({ source: entry.source });
			return;
		}
		if (
			claimed.leaf.isInit &&
			(claimed.folders.length === 0 || claimed.leaf.hoisted)
		) {
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

	private patternOf(
		entry: ScannedFile,
		isInit: boolean
	): { readonly match: PatternMatch; readonly at: string } | undefined {
		if (isInit) return undefined;
		const match = this.config.patterns.match(
			...[path.posix.basename(entry.source), entry.file.instanceName].map(
				(name) => InstanceName.unhoisted(name).name
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
