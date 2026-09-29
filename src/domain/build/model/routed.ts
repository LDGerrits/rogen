import { RojoScriptSuffix } from "../../rojo/rojo-assigned-name.js";
import { SuffixForm } from "../keys/declared-key.js";
import { ScanLeftOut, ScannedEntry } from "./scanned.js";

/** How a route or tag key matched a file. */
export type MatchForm = "folder" | "marker" | SuffixForm;

/** How the governing route matched the file; `fallback` is the `*` route. */
export type RouteMatch = MatchForm | "fallback";

export interface TagMatch {
	readonly tag: string;
	readonly form: MatchForm;
	/** The file name with a capital suffix written as a separator suffix. */
	readonly separatorName?: string;
}

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
	/** The file name with a capital route suffix written as a separator suffix that Rojo leaves in the name. */
	readonly separatorName?: string;
	/** The service, the target's folders, the file's own folders, then the instance name. */
	readonly instancePath: readonly string[];
	/** Routing, tag and invisible folders name no node, so they have none. */
	readonly folderNodes: readonly FolderNode[];
	/** Tag folders and suffixes are already out of `instancePath`; the tag stage decides what they mean. */
	readonly tags: readonly TagMatch[];
	/** A `.server`/`.client` that a tag suffix follows, which Rojo won't read as a script class. */
	readonly buriedScriptSuffix?: RojoScriptSuffix;
}

/** Why the build leaves a path out of the tree, in the words `where` reports it. */
export type LeftOut =
	| ScanLeftOut
	/** No route governs it. */
	| { readonly status: "unrouted" }
	/** Every dormant tag it carries, the first first. */
	| { readonly status: "pruned"; readonly tags: readonly TagMatch[] }
	/** Another file took its instance path. */
	| { readonly status: "replaced"; readonly by: string }
	/** The template defines the node it would be, or a `$path` above it. */
	| { readonly status: "displaced"; readonly node: readonly string[] };

/** Files from one root dir that claim one instance path; the tag stage kept the last. */
export interface InstanceClash {
	readonly instance: string;
	readonly claimants: readonly RoutedFile[];
}
