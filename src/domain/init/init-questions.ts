import { UsageError } from "../../base/errors.js";
import { joinedClosestFirst, joinedWithAnd } from "../../base/strings.js";
import { PromptService } from "../../platform/prompt/prompt-service.js";
import { DEFAULT_PROJECT_FILE } from "../config/config.js";
import { Language } from "../toolchain/toolchain.js";
import { HOOK_SCRIPT_FILE } from "./agent/coding-agent.js";
import { InitDirectory } from "./init-directory.js";
import {
	InitChoices,
	InitDecision,
	InitKind,
	booleanFlag,
} from "./init-service.js";
import { COMMON_FOLDER, PROJECTS_FOLDER } from "./starter-places.js";
import { TreeChoice } from "./tree-plan.js";

/** `value` is one of `known`, else a usage error naming them, the closest first. */
function oneOf(
	value: string,
	known: readonly string[],
	what: string,
	flag: string
): string {
	if (known.includes(value)) return value;
	throw new UsageError(
		`'${value}' is not ${what}.`,
		`The values of ${flag} are ${joinedClosestFirst(value, known)}.`
	);
}

/** Everything `init` asks. A question the user answered with a flag is not asked, and one a run that can't ask takes the default of is written to `decided`. A flag with a value that doesn't fit throws a `UsageError`. */
export class InitQuestions {
	readonly decided: InitDecision[] = [];

	constructor(
		private readonly promptService: PromptService,
		readonly interactive: boolean,
		readonly choices: InitChoices = {},
		/** Asks the questions that are always asked, where `promptService` takes the default of those a summary shows. */
		private readonly essential: PromptService = promptService
	) {}

	private decide<T extends InitDecision["value"]>(
		question: InitDecision["question"],
		value: T,
		flag: string
	): T {
		this.decided.push({ question, value, flag });
		return value;
	}

	/** The template of a new project; it is never asked, since Rojo's `init` doesn't ask it. */
	kind(): InitKind {
		const given = this.choices.kind;
		if (given !== undefined) return given;
		if (!this.interactive) this.decide("kind", "place", "--kind");
		return "place";
	}

	/** Whether to leave git out: no `.gitignore` and no `git init`. */
	skipGit(): boolean {
		const given = this.choices.skipGit;
		if (given !== undefined) return given;
		if (!this.interactive) this.decide("skipGit", false, "--skip-git");
		return false;
	}

	async addAgentInstructions(fileName: string): Promise<boolean | undefined> {
		if (this.choices.agentRules !== undefined)
			return this.choices.agentRules;
		if (!this.interactive)
			return this.decide("agentRules", true, "--no-agent-rules");
		return this.promptService.confirm({
			message: `Add Rogen's rules for coding agents to ${fileName}?`,
			description:
				"About 10 lines, read by every agent that opens this repo.",
			initialValue: true,
		});
	}

	async addAgentHook(
		agents: readonly string[]
	): Promise<boolean | undefined> {
		if (this.choices.agentHook !== undefined) return this.choices.agentHook;
		if (!this.interactive)
			return this.decide("agentHook", false, "--agent-hook");
		return this.promptService.confirm({
			message: `Add a hook that reports Rogen warnings to ${joinedWithAnd(agents)}?`,
			description: `Writes ${HOOK_SCRIPT_FILE} and registers it with ${agents.length === 1 ? "the agent" : "each agent"}. It runs when the agent is about to stop, on the files it changed.`,
			initialValue: false,
		});
	}

	/** Whether the Greeter sample is written, which only a flag turns off. */
	sample(): boolean {
		const given = this.choices.sample;
		if (given !== undefined) return given;
		if (!this.interactive) this.decide("sample", true, "--no-sample");
		return true;
	}

	/** Whether a new project is several places; a `projects` folder here makes it the default for a compiled language. */
	async places(
		directory: InitDirectory,
		language: Language
	): Promise<boolean | undefined> {
		const given = this.choices.places;
		if (given !== undefined) return given;
		const several =
			language.compiler !== undefined &&
			directory.has(PROJECTS_FOLDER) &&
			directory.layout.codeFolders.every(
				(folder) => folder === PROJECTS_FOLDER
			);
		if (!this.interactive)
			return this.decide(
				"places",
				several,
				booleanFlag("--places", !several)
			);
		const answer = await this.essential.select<"one" | "several">({
			message: "One place or several?",
			choices: [
				{
					value: "one",
					label: "One place",
					hint: "the code is in src",
				},
				{
					value: "several",
					label: "Several places",
					hint: language.compiler
						? `${PROJECTS_FOLDER}/${COMMON_FOLDER} holds the shared code, ${PROJECTS_FOLDER}/game the first place`
						: `src/${COMMON_FOLDER} holds the shared code, src/game the first place`,
				},
			],
			initialValue: several ? "several" : "one",
		});
		return answer === undefined ? undefined : answer === "several";
	}

	async language(directory: InitDirectory): Promise<Language | undefined> {
		const { workspace } = directory;
		const given = this.choices.language;
		if (given !== undefined)
			return workspace.languageFor(
				oneOf(
					given,
					workspace.languages.map(({ id }) => id),
					"a language",
					"--language"
				)
			);
		if (!this.interactive) {
			this.decide("language", workspace.language.id, "--language");
			return workspace.language;
		}
		const detected =
			workspace.languages.some(({ present }) => present) ||
			directory.layout.codeFolders.length > 0 ||
			directory.has("package.json");
		const id = await (
			detected ? this.promptService : this.essential
		).select({
			message: "Language",
			choices: workspace.languages.map((language) => ({
				value: language.id,
				label: language.copy.label,
				hint:
					language.id === workspace.language.id
						? language.copy.detectedHint
						: undefined,
			})),
			initialValue: workspace.language.id,
		});
		return id === undefined ? undefined : workspace.languageFor(id);
	}

	tree(directory: InitDirectory): TreeChoice {
		return directory.hasHandWrittenProject
			? { kind: "lift", from: DEFAULT_PROJECT_FILE }
			: { kind: "new" };
	}
}
