import { capitalized } from "../../base/string.js";
import { Registry } from "../../platform/registry/registry.js";
import { Extensions, Language, LanguageRegistry } from "./toolchain.js";

/** Plain Luau: Rojo syncs the root dirs as they are. It's what `init` assumes when no other language is found. */
const luau: Language = {
	id: "luau",
	label: "Luau",
	order: 0,
	extension: "luau",
	defaultPackageManager: "wally",

	detect: async () => ({ present: false, facts: {}, reservedFolders: [] }),
	routeKey: capitalized,
	configuredRootDir: () => undefined,
	alwaysMounted: () => [],
	offeredMounts: () => [],
};

Registry.as<LanguageRegistry>(Extensions.Languages).registerLanguage(luau);
