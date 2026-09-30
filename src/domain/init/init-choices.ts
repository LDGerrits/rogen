import { DARKLUA } from "./init-files.js";
import { DetectedWorkspace, Language, Mount } from "../toolchain/toolchain.js";
import { ConfigSet } from "./config-set.js";
import { defaultMounts } from "./mounts.js";
import { defaultRootDir } from "./root-dirs.js";
import { DEFAULT_ROUTES, RouteId } from "./starting-routes.js";
import { TemplateChoice, defaultTemplateChoice } from "./template.js";

/** Every answer the new-project questions give, whether asked or defaulted. */
export interface InitChoices {
	readonly name: string;
	readonly language: Language;
	readonly darklua: boolean;
	readonly rootDirs: readonly string[];
	readonly syncDir?: string;
	/** Where the compiler writes; Darklua reads it when both are used. */
	readonly outDir?: string;
	readonly template: TemplateChoice;
	readonly mounts: readonly Mount[];
	readonly routes: readonly RouteId[];
	/** Whether files that match no route go to the shared target, or are left out. */
	readonly fallback: boolean;
	/** Places set up alongside, each extending this config from `places/<name>`. */
	readonly places: readonly string[];
}

/** The sync dir `init` writes: Darklua's output, else the compiler's, else none. */
export function defaultSyncDir(
	language: Language,
	darklua: boolean
): string | undefined {
	if (darklua) return DARKLUA.defaultSyncDir;
	return language.compiler?.outDir;
}

/** The choices when every question takes its default, as a non-interactive `init` does. */
export function defaultInitChoices(
	workspace: DetectedWorkspace,
	language: Language,
	name: string,
	existingFiles: ReadonlySet<string>,
	withPlaces: boolean
): InitChoices {
	const darklua = workspace.usesDarklua;
	const syncDir = defaultSyncDir(language, darklua);
	const outDir = language.compiler?.outDir;
	const template = defaultTemplateChoice(
		existingFiles,
		new ConfigSet(name, language, darklua).outputFiles
	);
	return {
		name,
		language,
		darklua,
		rootDirs: [defaultRootDir(workspace, language)],
		...(syncDir && { syncDir }),
		...(outDir && { outDir }),
		template,
		mounts:
			template.kind === "use" ? [] : defaultMounts(workspace, language),
		routes: DEFAULT_ROUTES,
		fallback: true,
		places: withPlaces ? workspace.places : [],
	};
}
