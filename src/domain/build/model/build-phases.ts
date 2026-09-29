import { IndexReader } from "../../../platform/fs/index-service.js";
import { ResolvedConfig } from "../../config/config.js";
import { Target } from "../../roblox/target.js";
import { RojoProject } from "../../rojo/rojo-project.js";
import { RojoTree } from "../../rojo/rojo-tree.js";
import { DeclaredKeys } from "../keys/declared-key.js";
import { SyncLayout } from "../layout/sync-path.js";
import { FolderMeta, FolderMetaOutcome } from "./folder-meta.js";
import { PathReadings } from "./readings.js";
import { InstanceClash, LeftOut, RoutedFile } from "./routed.js";
import { ScannedRoot } from "./scanned.js";

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
