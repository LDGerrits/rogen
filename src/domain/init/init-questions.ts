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
import { ReviewPrompts } from "./review-prompts.js";
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

/** The code each layout would leave where no source path holds it, listed for a hint. */
export interface UnplacedCode {
	readonly one?: string;
	readonly several?: string;
}

/** A question whose answer the plan's summary would repeat. */
export type ShownQuestion = "language" | "places" | "sample";

/** Everything `init` asks. A question the user answered with a flag is not asked, and one a run that can't ask takes the default of is written to `decided`. A flag with a value that doesn't fit throws a `UsageError`. */
export class InitQuestions {
	readonly decided: InitDecision[] = [];
	/** The questions answered in the terminal, above the summary, which needn't repeat them. */
	readonly shown = new Set<ShownQuestion>();

	constructor(
		private readonly promptService: PromptService,
		readonly interactive: boolean,
		readonly choices: InitChoices = {},
		/** The review of a run that shows its plan first, which takes the default of the questions its summary shows until Customise. */
		private readonly review?: ReviewPrompts
	) {}

	/** Whether the quick questions are asked rather than taken by default, as under Customise. */
	get customising(): boolean {
		return this.review?.mode === "customise";
	}

	/** Where a question is asked: an `essential` one always, else as a default a summary shows. */
	private view(essential: boolean): PromptService {
		if (!this.review) return this.promptService;
		return essential ? this.review.essential : this.review.quick;
	}

	/** Whether the user sees a question: every `essential` one, and every one outside a review's quick pass. */
	private sees(essential: boolean): boolean {
		return essential || this.review?.mode !== "quick";
	}

	/** Asks a question, noting it when the user sees it. */
	private async ask<T>(
		question: ShownQuestion,
		essential: boolean,
		prompt: (view: PromptService) => Promise<T | undefined>
	): Promise<T | undefined> {
		const answer = await prompt(this.view(essential));
		if (this.sees(essential)) this.shown.add(question);
		return answer;
	}

	private decide<T extends InitDecision["value"]>(
		question: InitDecision["question"],
		value: T,
		flag: string
	): T {
		this.decided.push({ question, value, flag });
		return value;
	}

	/** The template of a new project; it is never asked, since Rojo's `init` doesn't ask it. A lifted project file is the kind it is, `lifted`; else a folder whose code is one module is a model. */
	kind(directory: InitDirectory, lifted?: InitKind): InitKind {
		const given = this.choices.kind;
		if (given !== undefined) return given;
		const kind =
			lifted ??
			(directory.isOneModule && !directory.hasHandWrittenProject
				? "model"
				: "place");
		if (!this.interactive) this.decide("kind", kind, "--kind");
		return kind;
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
		return this.view(false).confirm({
			id: "agentRules",
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
		return this.view(false).confirm({
			id: "agentHook",
			message: `Add a hook that reports Rogen warnings to ${joinedWithAnd(agents)}?`,
			description: `Writes ${HOOK_SCRIPT_FILE} and registers it with ${agents.length === 1 ? "the agent" : "each agent"}. It runs when the agent is about to stop, on the files it changed.`,
			initialValue: false,
		});
	}

	/** Whether the Greeter sample is written. */
	async sample(): Promise<boolean | undefined> {
		const given = this.choices.sample;
		if (given !== undefined) return given;
		if (!this.interactive)
			return this.decide("sample", true, "--no-sample");
		return this.ask("sample", false, (view) =>
			view.confirm({
				id: "sample",
				message: "Add the Greeter sample?",
				description:
					"Three hello-world scripts and a README, with Rojo's Baseplate and lighting for the place.",
				initialValue: true,
			})
		);
	}

	/** Whether `places` is asked up front: only in a folder without code, else as a default the summary shows. */
	private placesEssential(directory: InitDirectory): boolean {
		return !directory.holdsCode;
	}

	/** Whether the user sees `places`: in a terminal, when no flag answers it, up front or under Customise. */
	showsPlaces(directory: InitDirectory): boolean {
		return (
			this.interactive &&
			this.choices.places === undefined &&
			this.sees(this.placesEssential(directory))
		);
	}

	/** Whether a new project is several places, asked up front only in a folder without code; a `projects` folder here makes it the default for a compiled language. */
	async places(
		directory: InitDirectory,
		language: Language,
		unplaced: UnplacedCode = {}
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
		const answer = await this.ask(
			"places",
			this.placesEssential(directory),
			(view) =>
				view.select<"one" | "several">({
					id: "places",
					message: "One place or several?",
					choices: [
						{
							value: "one",
							label: "One place",
							hint: `the code is in ${directory.defaultSourcePath(language)}${unplaced.one ? `; leaves ${unplaced.one} unplaced` : ""}`,
						},
						{
							value: "several",
							label: "Several places",
							hint: `${
								language.compiler
									? `${PROJECTS_FOLDER}/${COMMON_FOLDER} holds the shared code, ${PROJECTS_FOLDER}/game the first place`
									: `src/${COMMON_FOLDER} holds the shared code, src/game the first place`
							}${unplaced.several ? `; leaves ${unplaced.several} unplaced` : ""}`,
						},
					],
					initialValue: several ? "several" : "one",
				})
		);
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
			directory.holdsCode ||
			directory.has("package.json");
		const id = await this.ask("language", !detected, (view) =>
			view.select({
				id: "language",
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
			})
		);
		return id === undefined ? undefined : workspace.languageFor(id);
	}

	tree(directory: InitDirectory): TreeChoice {
		return directory.hasHandWrittenProject
			? { kind: "lift", from: DEFAULT_PROJECT_FILE }
			: { kind: "new" };
	}
}
