import { UsageError } from "../../base/errors.js";
import { normalizeDir } from "../../base/path.js";
import { joinedClosestFirst, joinedWithAnd } from "../../base/strings.js";
import { PromptService } from "../../platform/prompt/prompt-service.js";
import { DEFAULT_PROJECT_FILE } from "../config/config.js";
import { Language, Mount, MountCandidate } from "../toolchain/toolchain.js";
import { HOOK_SCRIPT_FILE } from "./agent/coding-agent.js";
import { InitDirectory } from "./init-directory.js";
import { DerivedRoutes } from "./derived-routes.js";
import { RouteId, StartingRoutes } from "./starting-routes.js";
import { InitChoices, InitDecision, InitKind } from "./init-service.js";
import { COMMON_FOLDER, PROJECTS_FOLDER } from "./starter-places.js";
import { TreeChoice } from "./tree-plan.js";

/** What a list flag says to take none of. */
const NONE = "none";

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
		known.length === 0
			? `There is nothing here for ${flag} to take.`
			: `The values of ${flag} are ${joinedClosestFirst(value, known)}.`
	);
}

/** The values of a list flag that takes `none`, which stands for no value at all. */
function listOf(given: readonly string[], flag: string): readonly string[] {
	if (!given.includes(NONE)) return given;
	if (given.length > 1)
		throw new UsageError(
			`'${NONE}' can't be combined with other values of ${flag}.`
		);
	return [];
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
		question: string,
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
			return this.decide("agentRules", true, "--agent-rules");
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
			initialValue: true,
		});
	}

	/** Whether the Greeter sample is written, which only a flag turns off. */
	sample(): boolean {
		const given = this.choices.sample;
		if (given !== undefined) return given;
		if (!this.interactive) this.decide("sample", true, "--sample");
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
			return this.decide("places", several, "--places");
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

	private offeredMounts(
		directory: InitDirectory,
		language: Language
	): MountCandidate[] {
		return [
			...directory.workspace.packageMounts(language),
			...language.offeredMounts(),
		];
	}

	private static toMount({
		path,
		installed,
		landing,
	}: MountCandidate): Mount {
		return { path, optional: !installed, landing };
	}

	private selectMounts(
		directory: InitDirectory,
		language: Language,
		ticked: readonly string[]
	): Mount[] {
		return [
			...language.alwaysMounted().map(InitQuestions.toMount),
			...this.offeredMounts(directory, language)
				.filter(({ path }) => ticked.includes(path))
				.map(InitQuestions.toMount),
		];
	}

	async mounts(
		directory: InitDirectory,
		language: Language
	): Promise<readonly Mount[] | undefined> {
		const offered = this.offeredMounts(directory, language);
		const startsTicked = offered
			.filter(({ ticked }) => ticked)
			.map(({ path }) => path);
		const nothingToMount =
			directory.workspace.packageManager === undefined &&
			!offered.some(({ installed }) => installed);
		const given = this.choices.packages;
		if (given !== undefined) {
			const paths = offered.map(({ path }) => path);
			const chosen = listOf(given, "--package").map((path) =>
				oneOf(
					normalizeDir(path),
					paths,
					"a folder to mount",
					"--package"
				)
			);
			return this.selectMounts(directory, language, chosen);
		}
		if (offered.length === 0 || nothingToMount || !this.interactive) {
			if (offered.length > 0 && !nothingToMount)
				this.decide("packages", startsTicked, "--package");
			return this.selectMounts(directory, language, startsTicked);
		}

		const ticked = await this.promptService.multiSelect({
			message: "Packages",
			description: [
				"Folders placed in the game as they are. Rogen doesn't scan or route them.",
				language.copy.packagesNote,
			]
				.filter(Boolean)
				.join(" "),
			choices: offered.map(({ path, installed, landing }) => ({
				value: path,
				label: path,
				hint: `→ ${landing}${installed ? "" : " · not installed yet"}`,
			})),
			initialValues: startsTicked,
		});
		return ticked && this.selectMounts(directory, language, ticked);
	}

	async routes(
		language: Language,
		derived?: DerivedRoutes
	): Promise<{ routes: readonly RouteId[]; fallback: boolean } | undefined> {
		const starting = new StartingRoutes(language, derived);
		const ids = starting.options.map(({ id }) => id);
		const given = this.choices.routes;
		const server = language.routeKey("server");
		const { extension } = language;
		const routes: readonly RouteId[] | undefined =
			given !== undefined
				? listOf(given, "--route").map(
						(id) =>
							oneOf(
								starting.resolve(id),
								ids,
								"a route",
								"--route"
							) as RouteId
					)
				: !this.interactive
					? this.decide(
							"routes",
							[...starting.tickedByDefault],
							"--route"
						)
					: await this.promptService.multiSelect<RouteId>({
							message: "Routes",
							description: `Where code goes. A ${server} folder, an @server marker file or a Foo@server.${extension} suffix all send code to ServerScriptService.`,
							choices: starting.options.map(
								({ id, key, target, hint }) => ({
									value: id,
									label: key,
									hint: `→ ${target} · ${hint}`,
								})
							),
							initialValues: starting.tickedByDefault,
						});
		if (routes === undefined) return undefined;
		const unmatched = this.choices.unmatched;
		if (routes.length === 0) {
			if (unmatched !== undefined)
				throw new UsageError(
					"--unmatched has no route to apply to.",
					"Give a --route, or leave --unmatched out."
				);
			return { routes, fallback: true };
		}
		if (unmatched !== undefined)
			return { routes, fallback: unmatched === "shared" };
		const byDefault = "shared";
		if (!this.interactive) {
			this.decide("unmatched", byDefault, "--unmatched");
			return { routes, fallback: true };
		}

		const fallback = await this.promptService.select<"shared" | "leave">({
			message: "Files that match no route",
			description:
				"Rogen can't tell server code by reading it, and shared code reaches every client. Left out, a file gets a warning that names the folder to move it into.",
			choices: [
				{
					value: "shared",
					label: `Put them in ${starting.fallbackTarget}`,
				},
				{
					value: "leave",
					label: "Leave them out (Rogen warns when it does)",
				},
			],
			initialValue: byDefault,
		});
		return fallback && { routes, fallback: fallback === "shared" };
	}
}
