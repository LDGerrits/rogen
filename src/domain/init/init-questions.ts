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

function oneOf<T extends string>(
	value: string,
	known: readonly T[],
	what: string,
	flag: string
): T {
	const found = known.find((candidate) => candidate === value);
	if (found !== undefined) return found;
	throw new UsageError(
		`'${value}' is not ${what}.`,
		`The values of ${flag} are ${joinedClosestFirst(value, known)}.`
	);
}

export interface UnplacedCode {
	readonly one?: string;
	readonly several?: string;
}

export type ShownQuestion = "language" | "places" | "sample";

export class InitQuestions {
	readonly decided: InitDecision[] = [];
	readonly shown = new Set<ShownQuestion>();

	constructor(
		readonly interactive: boolean,
		readonly choices: InitChoices = {},
		private readonly review: ReviewPrompts | undefined,
		@PromptService private readonly promptService: PromptService
	) {}

	get customising(): boolean {
		return this.review?.mode === "customise";
	}

	private view(essential: boolean): PromptService {
		if (!this.review) return this.promptService;
		return essential ? this.review.essential : this.review.quick;
	}

	private sees(essential: boolean): boolean {
		return essential || this.review?.mode !== "quick";
	}

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

	private placesEssential(directory: InitDirectory): boolean {
		return !directory.holdsCode;
	}

	showsPlaces(directory: InitDirectory): boolean {
		return (
			this.interactive &&
			this.choices.places === undefined &&
			this.sees(this.placesEssential(directory))
		);
	}

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
