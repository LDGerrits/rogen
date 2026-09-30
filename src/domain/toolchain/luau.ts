import { capitalized } from "../../base/string.js";
import {
	Language,
	LanguageDetection,
	MountCandidate,
	PackageManager,
} from "./toolchain.js";

/** Plain Luau: Rojo syncs the root dirs as they are. It's what `init` assumes when no other language is found. */
export class Luau implements Language {
	readonly id = "luau";
	readonly label = "Luau";
	readonly extension = "luau";
	readonly defaultPackageManager: PackageManager = "wally";

	async detect(): Promise<LanguageDetection> {
		return { present: false, reservedFolders: [] };
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
