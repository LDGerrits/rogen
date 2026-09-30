import { capitalized } from "../../base/string.js";
import {
	Language,
	LanguageDetector,
	MountCandidate,
	PackageManager,
} from "./toolchain.js";

/** Plain Luau: Rojo syncs the root dirs as they are. It's what `init` assumes when no other language is found. */
export class Luau implements Language, LanguageDetector {
	readonly id = "luau";
	readonly label = "Luau";
	readonly extension = "luau";
	readonly defaultPackageManager = PackageManager.WALLY;
	readonly present = false;
	readonly reservedFolders: readonly string[] = [];

	/** Luau leaves nothing of its own in the workspace, so there is nothing to read. */
	async detect(): Promise<Language> {
		return this;
	}

	routeKey(id: string): string {
		return capitalized(id);
	}

	configuredRootDir(): undefined {
		return undefined;
	}

	alwaysMounted(): readonly MountCandidate[] {
		return [];
	}

	offeredMounts(): readonly MountCandidate[] {
		return [];
	}
}
