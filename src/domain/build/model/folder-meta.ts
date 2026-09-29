import { RojoNode } from "../../rojo/rojo-tree.js";
import { RoutedFile } from "./routed.js";

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
