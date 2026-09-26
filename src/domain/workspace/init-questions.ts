import { PromptService } from "../../platform/prompt/prompt-service.js";
import { DEFAULT_CONFIG_STEM } from "../config/config-discovery.js";
import { DetectedWorkspace, Toolchain } from "./detect-workspace.js";
import {
	InitChoices,
	defaultInitChoices,
	mountCandidates,
	parseInitName,
	syncDirFor,
} from "./init-plan.js";

const TOOLCHAINS = [
	{ value: "roblox-ts", label: "roblox-ts" },
	{ value: "darklua", label: "Darklua" },
	{ value: "luau", label: "Plain Luau" },
] as const satisfies readonly { value: Toolchain; label: string }[];

const required = (what: string) => (value: string) =>
	value.trim() === "" ? `Enter ${what}.` : undefined;

const splitList = (value: string): string[] =>
	value
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");

/** Resolves to `undefined` when the user cancels. `name` skips the name question. */
export async function askInitChoices(
	promptService: PromptService,
	workspace: DetectedWorkspace,
	name?: string
): Promise<InitChoices | undefined> {
	const chosenName =
		name ??
		(await promptService.text({
			message: "Config name",
			description: `Writes <name>.rogen.json. "${DEFAULT_CONFIG_STEM}" is the one a bare command finds.`,
			placeholder: DEFAULT_CONFIG_STEM,
			validate: (value) => {
				const parsed = parseInitName([value]);
				return parsed.isErr() ? parsed.error.message : undefined;
			},
		}));
	if (chosenName === undefined) return undefined;

	const toolchain = await promptService.select<Toolchain>({
		message: "Toolchain",
		choices: TOOLCHAINS,
		initialValue: workspace.toolchain,
	});
	if (toolchain === undefined) return undefined;

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
	if (rootDirs === undefined) return undefined;

	let syncDir: string | undefined;
	if (toolchain !== "luau") {
		const answer = await promptService.text({
			message: "Sync dir",
			description: "The folder Rojo syncs from.",
			placeholder: syncDirFor(toolchain, workspace),
			validate: required("a sync dir"),
		});
		if (answer === undefined) return undefined;
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
	if (mounted === undefined) return undefined;

	return {
		name: chosenName,
		toolchain,
		rootDirs: splitList(rootDirs),
		...(syncDir && { syncDir }),
		mounts: candidates
			.filter(({ path }) => mounted.includes(path))
			.map(({ path, installed }) => ({ path, optional: !installed })),
	};
}
