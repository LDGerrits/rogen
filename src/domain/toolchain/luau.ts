import {
	Language,
	LanguageCopy,
	LanguageDetector,
	Mount,
	PackageManager,
} from "./toolchain.js";

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
		return id;
	}

	configuredSourcePath(): undefined {
		return undefined;
	}

	mounts(): readonly Mount[] {
		return [];
	}
}
