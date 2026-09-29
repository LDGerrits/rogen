import { IndexReader } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { Target } from "../roblox/roblox.js";
import { RojoFileKind, RojoScriptSuffix } from "../rojo/rojo-files.js";
import { RojoNode, RojoProject, RojoTree } from "../rojo/rojo-project.js";
import {
	DeclaredKeys,
	FolderReading,
	SuffixForm,
	SuffixMatch,
} from "./declared-keys.js";
import { SyncLayout } from "./sync-layout.js";

export interface ScannedFile {
	readonly kind: RojoFileKind;
	readonly rootDir: string;
	readonly relativePath: string;
	/** The absolute POSIX source path. */
	readonly source: string;
}

export interface ScannedInitFolder {
	readonly kind: "init-folder";
	readonly rootDir: string;
	readonly relativePath: string;
	/** The absolute POSIX path of the folder. */
	readonly source: string;
	readonly initFile: string;
}

export type ScannedEntry = ScannedFile | ScannedInitFolder;

/** Why the scan left a path out; the path is the key it is stored under. */
export type ScanLeftOut =
	| { readonly status: "excluded"; readonly pattern: string }
	/** A link that loops back to an ancestor or points at nothing, which Rojo must never walk. */
	| { readonly status: "skipped" };

export interface ScannedRoot {
	readonly rootDir: string;
	/** False for a root dir the index doesn't hold, which contributes nothing. */
	readonly exists: boolean;
	readonly entries: readonly ScannedEntry[];
	readonly markers: readonly string[];
	/** `.meta.json` files, `init.meta.json` included; Rojo applies them, they're never entries. */
	readonly metaFiles: readonly string[];
	/** The paths the scan left out, by absolute POSIX path. */
	readonly leftOut: ReadonlyMap<string, ScanLeftOut>;
}

/** A folder read once: what its name means, and the declared key it only differs from in case. */
export type FolderRead = FolderReading & {
	readonly segment: string;
	/** The folder relative to the root dir. */
	readonly dir: string;
	readonly nearMissKey?: string;
};

export interface MarkerRead {
	/** The declared route or tag key the marker spells. */
	readonly key: string | undefined;
	readonly nearMissKey: string | undefined;
}

/** An entry read once: its folders and the suffixes on the file that carries its name. */
export interface EntryRead {
	/** The folders above the entry, outermost first. */
	readonly folders: readonly FolderRead[];
	/** The file whose stem carries the suffixes: an init folder's script, or the file itself. */
	readonly fileName: string;
	readonly kind: RojoFileKind;
	readonly stem: string;
	readonly match: SuffixMatch;
}

/** Every folder, marker and suffix the declared keys can claim, read once and shared by the stages and rules. */
export interface PathReadings {
	/** By absolute POSIX path; holds every folder above an entry, marker or meta file. */
	readonly folders: ReadonlyMap<string, FolderRead>;
	/** By absolute POSIX path. */
	readonly markers: ReadonlyMap<string, MarkerRead>;
	/** By the entry's source. */
	readonly entries: ReadonlyMap<string, EntryRead>;
}

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

export interface FolderMetaFields {
	readonly className?: string;
	readonly properties?: Readonly<Record<string, unknown>>;
	readonly attributes?: Readonly<Record<string, unknown>>;
	readonly ignoreUnknownInstances?: boolean;
	readonly id?: string;
}

export interface FolderMeta extends FolderMetaFields {
	readonly file: string;
	readonly rootDir: string;
	/** The folder, relative to the root dir; the root dir itself is "". */
	readonly dir: string;
}

/** What became of the folder meta that reaches one node Rojo wouldn't apply it to. */
export type FolderMetaOutcome =
	| {
			readonly kind: "copied";
			readonly instancePath: readonly string[];
			readonly meta: FolderMeta;
			readonly templateNode: RojoNode;
	  }
	/** A file is what Rojo reads at the node, so every meta reaching it applies to nothing. */
	| {
			readonly kind: "shared";
			readonly instance: string;
			readonly metas: readonly FolderMeta[];
			readonly file: RoutedFile;
	  }
	| {
			readonly kind: "templatePath";
			readonly instance: string;
			readonly meta: FolderMeta;
	  };

/** What the config and the environment settle before anything is scanned. */
export interface PreparedBuild {
	readonly config: ResolvedConfig;
	readonly index: IndexReader;
	readonly layout: SyncLayout;
	/** The template rebased to the output's dir, or a bare DataModel. */
	readonly template: RojoProject;
	readonly keys: DeclaredKeys;
	/** Each route key's parsed target. */
	readonly targets: ReadonlyMap<string, Target>;
}

/** Where every scanned file lands, or why it lands nowhere; `where` stops here. */
export interface PlacedBuild extends PreparedBuild {
	readonly roots: readonly ScannedRoot[];
	readonly readings: PathReadings;
	/** Every file a route governs, in scan order, before tags decide which are placed. */
	readonly routed: readonly RoutedFile[];
	/** Every instance path appears once; the last root dir wins across roots. */
	readonly files: readonly RoutedFile[];
	/** Every path the build leaves out of the tree, by absolute POSIX path. */
	readonly leftOut: ReadonlyMap<string, LeftOut>;
	readonly clashes: readonly InstanceClash[];
}

/** The placed build with its tree; what rules report on. */
export interface AssembledBuild extends PlacedBuild {
	readonly folderMeta: readonly FolderMeta[];
	/** Directories written as one `$path`, mapped to the instance each becomes. */
	readonly collapsed: ReadonlyMap<string, readonly string[]>;
	readonly metaOutcomes: readonly FolderMetaOutcome[];
	readonly tree: RojoTree;
}
