import { capitalized } from "../../base/strings.js";
import {
	Language,
	LanguageCopy,
	LanguageDetector,
	MountCandidate,
	PackageManager,
} from "./toolchain.js";

/** Plain Luau, the language assumed when no other is found. */
export class Luau implements Language, LanguageDetector {
	readonly id = "luau";
	readonly copy: LanguageCopy = { label: "Luau" };
	readonly extension = "luau";
	readonly defaultPackageManager = PackageManager.WALLY;
	readonly present = false;
	readonly reservedFolders: readonly string[] = [];

	async detect(): Promise<Language> {
		return this;
	}

	routeKey(id: string): string {
		return capitalized(id);
	}

	configuredSourcePath(): undefined {
		return undefined;
	}

	alwaysMounted(): readonly MountCandidate[] {
		return [];
	}

	installedMounts(): readonly MountCandidate[] {
		return [];
	}
}
