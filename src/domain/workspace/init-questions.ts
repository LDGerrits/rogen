import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { PromptService } from "../../platform/prompt/prompt-service.js";
import {
	CONFIG_SUFFIX,
	DEFAULT_CONFIG_STEM,
} from "../config/config-discovery.js";
import { DetectedWorkspace, Language } from "./detect-workspace.js";
import {
	TemplateMount,
	defaultMounts,
	offeredMounts,
	selectMounts,
} from "./init-mounts.js";
import {
	InitChoices,
	TEMPLATE_FILE,
	configFileNames,
	existingFileDiagnostics,
	parseInitName,
	sourceStemOf,
	syncDirFor,
} from "./init-plan.js";
import { defaultRootDir, otherCodeFoldersHint } from "./init-root-dirs.js";
import {
	RouteId,
	routeKey,
	routeOptions,
	sharedTarget,
} from "./starting-routes.js";

export interface InitContext {
	readonly workspace: DetectedWorkspace;
	readonly directory: string;
	/** The names of the entries already in `directory`. */
	readonly existingFiles: ReadonlySet<string>;
}

const required = (what: string) => (value: string) =>
	value.trim() === "" ? `Enter ${what}.` : undefined;

const splitList = (value: string): string[] =>
	value
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");

/**
 * Resolves to `ok(undefined)` when the user cancels, and to `err` as soon as a
 * file the answers would write already exists. `name` skips the name question.
 */
export async function askInitChoices(
	promptService: PromptService,
	context: InitContext,
	name?: string
): Promise<Result<InitChoices | undefined, Diagnostic[]>> {
	const { workspace, directory, existingFiles } = context;

	const chosenName = name ?? (await askName(promptService, existingFiles));
	if (chosenName === undefined) return ok(undefined);

	const language = await promptService.select<Language>({
		message: "Language",
		description:
			"Sets the route key casing and which packages are offered.",
		choices: [
			{ value: "luau", label: "Luau" },
			{
				value: "roblox-ts",
				label: "roblox-ts",
				hint:
					workspace.language === "roblox-ts"
						? "found tsconfig.json"
						: undefined,
			},
		],
		initialValue: workspace.language,
	});
	if (language === undefined) return ok(undefined);

	const darklua = await promptService.confirm({
		message: "Does Darklua process your code before Rojo syncs it?",
		description:
			"Darklua writes a processed copy of your code, and Rojo syncs that copy instead.",
		hint: workspace.darklua ? "found .darklua.json" : undefined,
		initialValue: workspace.darklua,
	});
	if (darklua === undefined) return ok(undefined);

	const conflicts = existingFileDiagnostics(
		configFileNames(chosenName, language, darklua),
		directory,
		existingFiles
	);
	if (conflicts.length > 0) return err(conflicts);

	const rootPlaceholder = defaultRootDir(workspace, language);
	const rootDirs = await promptService.text({
		message: "Root dirs",
		description:
			"Folders Rogen scans for scripts, relative to here. Separate several with commas; they're merged into one tree, and on a clash the later one wins.",
		hint: otherCodeFoldersHint(workspace, rootPlaceholder),
		placeholder: rootPlaceholder,
		validate: (value) =>
			splitList(value).length === 0
				? "Enter at least one root dir."
				: undefined,
	});
	if (rootDirs === undefined) return ok(undefined);

	let syncDir: string | undefined;
	if (language === "roblox-ts" || darklua) {
		const answer = await promptService.text({
			message: "Sync dir",
			description: darklua
				? "The folder Darklua writes into. Rojo syncs from here."
				: "The folder roblox-ts compiles into (outDir in tsconfig.json). Rojo syncs from here.",
			placeholder: syncDirFor(language, darklua, workspace),
			validate: required("a sync dir"),
		});
		if (answer === undefined) return ok(undefined);
		syncDir = answer.trim();
	}

	const mounts = await askMounts(promptService, context, language);
	if (mounts === undefined) return ok(undefined);

	const routes = await askRoutes(promptService, language);
	if (routes === undefined) return ok(undefined);

	return ok({
		name: chosenName,
		language,
		darklua,
		rootDirs: splitList(rootDirs),
		...(syncDir && { syncDir }),
		mounts,
		routes: routes.routes,
		fallback: routes.fallback,
	});
}

async function askMounts(
	promptService: PromptService,
	{ workspace, existingFiles }: InitContext,
	language: Language
): Promise<readonly TemplateMount[] | undefined> {
	const offered = offeredMounts(workspace, language);
	if (offered.length === 0 || existingFiles.has(TEMPLATE_FILE)) {
		return defaultMounts(workspace, language);
	}

	const ticked = await promptService.multiSelect({
		message: "Packages",
		description:
			language === "roblox-ts"
				? "Folders placed in the game as they are. Rogen doesn't scan or route them. include and @rbxts are always mounted."
				: "Folders placed in the game as they are. Rogen doesn't scan or route them.",
		choices: offered.map(({ path, installed, landing }) => ({
			value: path,
			label: path,
			hint: `→ ${landing}${installed ? "" : " · not installed yet"}`,
		})),
		initialValues: offered
			.filter(({ installed }) => installed)
			.map(({ path }) => path),
	});
	return ticked && selectMounts(workspace, language, ticked);
}

async function askRoutes(
	promptService: PromptService,
	language: Language
): Promise<{ routes: readonly RouteId[]; fallback: boolean } | undefined> {
	const options = routeOptions(language);
	const server = routeKey("server", language);
	const routes = await promptService.multiSelect<RouteId>({
		message: "Routes",
		description: `A route sends code to a service. A ${server} folder, a ${server}.luau marker file or a Foo.server.luau suffix all send code to ServerScriptService. Add your own later under "routes".`,
		choices: options.map(({ id, key, target, hint }) => ({
			value: id,
			label: key,
			hint: `→ ${target} · ${hint}`,
		})),
		initialValues: options
			.filter(({ ticked }) => ticked)
			.map(({ id }) => id),
	});
	if (routes === undefined) return undefined;
	if (routes.length === 0) return { routes, fallback: true };

	const fallback = await promptService.select<"shared" | "leave">({
		message: "Files that match no route",
		description: "Most loose modules in a feature folder are shared code.",
		choices: [
			{
				value: "shared",
				label: `Put them in ${sharedTarget(language)}`,
			},
			{
				value: "leave",
				label: "Leave them out (Rogen warns when it does)",
			},
		],
		initialValue: "shared",
	});
	return fallback && { routes, fallback: fallback === "shared" };
}

async function askName(
	promptService: PromptService,
	existingFiles: ReadonlySet<string>
): Promise<string | undefined> {
	const defaultFile = `${DEFAULT_CONFIG_STEM}${CONFIG_SUFFIX}`;
	if (!existingFiles.has(defaultFile)) return DEFAULT_CONFIG_STEM;

	return promptService.text({
		message: "Config name",
		description: `Writes <name>.rogen.json. ${defaultFile} already exists, so pick another name, such as test.`,
		validate: (value) => {
			if (value.trim() === "") return "Enter a name.";
			const parsed = parseInitName([value]);
			if (parsed.isErr()) return parsed.error.message;
			const taken = [
				`${value}${CONFIG_SUFFIX}`,
				`${sourceStemOf(value)}${CONFIG_SUFFIX}`,
			].find((file) => existingFiles.has(file));
			return taken && `${taken} already exists.`;
		},
	});
}
