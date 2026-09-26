import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { PromptService } from "../../platform/prompt/prompt-service.js";
import {
	CONFIG_SUFFIX,
	DEFAULT_CONFIG_STEM,
} from "../config/config-discovery.js";
import { DetectedWorkspace, Language } from "./detect-workspace.js";
import {
	InitChoices,
	configFileNames,
	defaultInitChoices,
	existingFileDiagnostics,
	mountCandidates,
	parseInitName,
	sourceStemOf,
	syncDirFor,
} from "./init-plan.js";

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

	const rootDirs = await promptService.text({
		message: "Root dirs",
		description:
			"Folders Rogen scans for scripts. Separate several with commas.",
		placeholder: "src",
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

	const candidates = mountCandidates(workspace);
	const defaults = defaultInitChoices(workspace, chosenName);
	const mounted = await promptService.multiSelect({
		message: "Template mounts",
		choices: candidates.map(({ path, installed }) => ({
			value: path,
			label: path,
			hint: installed ? "found" : "not installed, mounted as optional",
		})),
		initialValues: defaults.mounts.map(({ path }) => path),
	});
	if (mounted === undefined) return ok(undefined);

	return ok({
		name: chosenName,
		language,
		darklua,
		rootDirs: splitList(rootDirs),
		...(syncDir && { syncDir }),
		mounts: candidates
			.filter(({ path }) => mounted.includes(path))
			.map(({ path, installed }) => ({ path, optional: !installed })),
	});
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
