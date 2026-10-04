import { joinPosix } from "../../base/path.js";
import { DeclaredKeys } from "../config/config.js";
import { Target } from "../roblox/roblox.js";
import { RojoFile, RojoScriptSuffix } from "../rojo/rojo-file.js";
import { MatchForm, RouteMatch, TagMatch } from "./build.js";
import { EntryRead, NameReadings, SuffixSpan } from "./name-reader.js";
import { ScannedEntry, ScannedRoot, rojoNameOf } from "./root-scanner.js";

/** A node one of the file's own folders becomes, with that folder relative to the root dir. */
export interface FolderNode {
	readonly instancePath: readonly string[];
	readonly dir: string;
}

export interface RoutedFile {
	readonly entry: ScannedEntry;
	/** The governing route key, or `*`. */
	readonly route: string;
	readonly routeMatch: RouteMatch;
	/** The service, the target's folders, the file's own folders, then the instance name. */
	readonly instancePath: readonly string[];
	/** Routing, tag and invisible folders name no node, so they have none; a routing folder that an outer route outranks is an ordinary folder. */
	readonly folderNodes: readonly FolderNode[];
	/** The route keys that name the file but sit under the governing route, so they changed nothing. */
	readonly ignoredRoutes: readonly string[];
	/** Tag folders and suffixes are already out of `instancePath`; the tag stage decides what they mean. */
	readonly tags: readonly TagMatch[];
	/** A `.server`/`.client` that a tag suffix follows, which Rojo won't read as a script class. */
	readonly buriedScriptSuffix?: RojoScriptSuffix;
}

/** What the folders and markers above a file, then its own suffixes, claim for it; the outermost route wins. */
class Claims {
	route: { readonly key: string; readonly match: MatchForm } | undefined;
	readonly ignoredRoutes: string[] = [];
	readonly tags: TagMatch[] = [];

	/** Whether the route governs; a later one is ignored whole. */
	claimRoute(key: string, match: MatchForm): boolean {
		if (this.route) {
			this.ignoredRoutes.push(key);
			return false;
		}
		this.route = { key, match };
		return true;
	}

	claimTag(tag: TagMatch): void {
		this.tags.push(tag);
	}
}

interface LeafReading {
	readonly name: string;
	readonly buriedScriptSuffix: RojoScriptSuffix | undefined;
}

/** Finds each scanned file's governing route and instance path. */
export class Router {
	constructor(
		private readonly keys: DeclaredKeys,
		private readonly targets: ReadonlyMap<string, Target>,
		private readonly readings: NameReadings
	) {}

	/** Every file a route governs, in scan order, and the sources of the files no route governs. */
	route(roots: readonly ScannedRoot[]): {
		routed: RoutedFile[];
		unrouted: string[];
	} {
		const routed: RoutedFile[] = [];
		const unrouted: string[] = [];
		for (const root of roots) {
			const markers = root.markersByDir();
			for (const entry of root.entries) {
				const outcome = this.routeEntry(entry, markers);
				if (outcome) routed.push({ entry, ...outcome });
				else unrouted.push(entry.source);
			}
		}
		return { routed, unrouted };
	}

	private routeEntry(
		entry: ScannedEntry,
		markers: ReadonlyMap<string, string[]>
	): Omit<RoutedFile, "entry"> | undefined {
		const read = this.readings.entryAt(entry.source);
		const claims = new Claims();
		const folders = this.readFolders(entry, read, markers, claims);
		const { name, buriedScriptSuffix } = this.readLeaf(entry, read, claims);

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
			route,
			routeMatch: claims.route?.match ?? "fallback",
			instancePath: [...parent, name],
			folderNodes,
			ignoredRoutes: claims.ignoredRoutes,
			tags: claims.tags,
			buriedScriptSuffix,
		};
	}

	/** Routing, tag and invisible folders and markers claim the file; every other folder, a `Name@key` routing folder and a routing folder an outer route outranks becomes a node. */
	private readFolders(
		entry: ScannedEntry,
		read: EntryRead,
		markers: ReadonlyMap<string, string[]>,
		claims: Claims
	): { readonly name: string; readonly dir: string }[] {
		const applyMarkers = (dir: string) => {
			for (const fileName of markers.get(dir) ?? []) {
				const key = this.readings.markers.get(
					joinPosix(entry.rootDir, dir, fileName)
				)?.key;
				if (key === undefined) continue;
				if (this.keys.isTag(key))
					claims.claimTag({ tag: key, form: "marker" });
				else claims.claimRoute(key, "marker");
			}
		};

		applyMarkers("");
		const folders: { name: string; dir: string }[] = [];
		for (const folder of read.folders) {
			if (folder.kind === "route") {
				if (claims.claimRoute(folder.key, "folder")) {
					if (folder.keptName !== undefined && !folder.invisible)
						folders.push({
							name: folder.keptName,
							dir: folder.dir,
						});
				} else if (!folder.invisible)
					folders.push({ name: folder.segment, dir: folder.dir });
			} else if (folder.kind === "tag")
				claims.claimTag({ tag: folder.key, form: "folder" });
			else if (!folder.invisible)
				folders.push({ name: folder.segment, dir: folder.dir });
			applyMarkers(folder.dir);
		}
		return folders;
	}

	/** Reads the suffixes of a file, or of an init folder's script, into `claims` and returns the instance name. */
	private readLeaf(
		entry: ScannedEntry,
		{ kind, stem, match }: EntryRead,
		claims: Claims
	): LeafReading {
		const tagSpans = match.spans.filter((span) =>
			this.keys.isTag(span.key)
		);
		for (const span of tagSpans) claims.claimTag(this.asTagMatch(span));
		let routeSpan: SuffixSpan | undefined;
		for (const span of match.spans)
			if (
				this.keys.routeKeys.has(span.key) &&
				claims.claimRoute(span.key, "suffix")
			)
				routeSpan = span;

		// Rojo names an init folder after the folder, so its script's suffixes only route.
		if (entry.kind === "init-folder") {
			return { name: rojoNameOf(entry), buriedScriptSuffix: undefined };
		}

		const buriedScriptSuffix =
			kind === "script" &&
			tagSpans.length > 0 &&
			!RojoFile.scriptSuffixOf(stem)
				? RojoFile.scriptSuffixOf(this.stripSpans(stem, tagSpans))
				: undefined;
		const stripped = this.stripSpans(
			stem,
			routeSpan ? [...tagSpans, routeSpan] : tagSpans
		);
		return {
			name:
				kind === "script" ? RojoFile.scriptNameOf(stripped) : stripped,
			buriedScriptSuffix,
		};
	}

	private asTagMatch(span: SuffixSpan): TagMatch {
		return { tag: span.key, form: "suffix" };
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
