import { containsPath, normalizeDir } from "../../base/path.js";
import { joinedWithAnd } from "../../base/strings.js";
import { PromptService } from "../../platform/prompt/prompt-service.js";
import { DEFAULT_CONFIG_FILE, DEFAULT_PROJECT_FILE } from "../config/config.js";
import { EnclosingConfigs } from "../config/config-service.js";
import { Language, Mount, MountCandidate } from "../toolchain/toolchain.js";
import { HOOK_SCRIPT_FILE } from "./agent/coding-agent.js";
import { InitDirectory } from "./init-directory.js";
import { DerivedRoutes } from "./derived-routes.js";
import { RouteId, StartingRoutes } from "./starting-routes.js";
import { TreeChoice } from "./tree-plan.js";

/** One thing `init` can add beside the config here, and what adding it does. */
export interface AdditionOption<T> {
	readonly id: string;
	readonly label: string;
	readonly hint: string;
	readonly addition: T;
}

const required = (what: string) => (value: string) =>
	value.trim() === "" ? `Enter ${what}.` : undefined;

const splitList = (value: string): string[] =>
	value
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");

/** The questions `init` asks; each owns its default, which a run that can't ask takes without prompting. */
export class InitQuestions {
	/** `interactive` is false for a run that may not ask, even in a terminal. */
	constructor(
		private readonly promptService: PromptService,
		readonly interactive: boolean
	) {}

	/** Whether to start a project below `enclosing`'s configs; a run that can't ask never does. */
	async startNestedProject({
		directory,
		fileNames,
	}: EnclosingConfigs): Promise<boolean | undefined> {
		if (!this.interactive) return false;
		return this.promptService.confirm({
			message: `${directory} already has ${fileNames.join(", ")}. Start a separate project here anyway?`,
			description:
				"This folder may already be part of that project, and a project here would then be built twice.",
			initialValue: false,
		});
	}

	/** How to list a place in `placePaths`: the glob that matches its parent's folders (the default), or the folder itself; a run that can't ask takes the glob. */
	async placeListing(
		glob: string,
		folder: string
	): Promise<string | undefined> {
		if (!this.interactive) return glob;
		const answer = await this.promptService.select<"glob" | "folder">({
			message: "How do you want to list this place?",
			choices: [
				{
					value: "glob",
					label: glob,
					hint: "every folder there is a place",
				},
				{ value: "folder", label: folder, hint: "only this folder" },
			],
			initialValue: "glob",
		});
		return answer === undefined
			? undefined
			: answer === "glob"
				? glob
				: folder;
	}

	/** What to add beside the config in `configFile`, among `options`, which are never empty; a run that can't ask takes the first, as Enter does. */
	async whatToAdd<T>(
		configFile: string,
		options: readonly AdditionOption<T>[]
	): Promise<T | undefined> {
		const [first] = options;
		if (!this.interactive) return first.addition;
		const id = await this.promptService.select<string>({
			message: `${configFile} exists. What do you want to add?`,
			choices: options.map(({ id, label, hint }) => ({
				value: id,
				label,
				hint,
			})),
			initialValue: first.id,
		});
		return options.find((option) => option.id === id)?.addition;
	}

	/** Whether to add Rogen's rules to the agent file; a run that can't ask adds them, as Enter does. */
	async addAgentInstructions(fileName: string): Promise<boolean | undefined> {
		if (!this.interactive) return true;
		return this.promptService.confirm({
			message: `Add Rogen's rules for coding agents to ${fileName}?`,
			description:
				"About 10 lines, read by every agent that opens this repo.",
			initialValue: true,
		});
	}

	/** Whether to add the hook that reports Rogen warnings to `agents`; a run that can't ask doesn't, since it edits the repo's tooling. */
	async addAgentHook(
		agents: readonly string[]
	): Promise<boolean | undefined> {
		if (!this.interactive) return false;
		return this.promptService.confirm({
			message: `Add a hook that reports Rogen warnings to ${joinedWithAnd(agents)}?`,
			description: `Writes ${HOOK_SCRIPT_FILE} and registers it with ${agents.length === 1 ? "the agent" : "each agent"}. It runs when the agent is about to stop, on the files it changed.`,
			initialValue: true,
		});
	}

	/** The language the project is written in, the detected one unless told otherwise. */
	async language({
		workspace,
	}: InitDirectory): Promise<Language | undefined> {
		if (!this.interactive) return workspace.language;
		const id = await this.promptService.select({
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

	/** Whether Darklua processes the code, as it does when the workspace has a config for it. */
	darklua({ workspace }: InitDirectory): Promise<boolean | undefined> {
		const found = workspace.darkluaConfig !== undefined;
		if (!this.interactive) return Promise.resolve(found);
		return this.promptService.confirm({
			message: "Does Darklua process your code before Rojo syncs it?",
			description:
				"Darklua writes a processed copy of your code, and Rojo syncs that copy instead.",
			hint: found ? `found ${workspace.darkluaConfig}` : undefined,
			initialValue: found,
		});
	}

	/** The folders of the project's code. */
	async sourcePaths(
		directory: InitDirectory,
		language: Language
	): Promise<string[] | undefined> {
		const placeholder = directory.defaultSourcePath(language);
		if (!this.interactive) return [placeholder];

		const { compiler } = language;
		const copy = language.copy.sourcePath;
		const answer = await this.promptService.text({
			message: compiler ? "Source path" : "Source paths",
			description: compiler
				? copy?.description
				: "Folders with your scripts, relative to here. Separate several with commas.",
			hint: directory.otherCodeFoldersHint(placeholder),
			placeholder,
			validate: (value) => {
				const entries = splitList(value);
				const problem = directory.sourcePathsProblem(entries);
				if (problem) return problem;
				return compiler && entries.length > 1
					? copy?.severalProblem
					: undefined;
			},
		});
		return answer === undefined
			? undefined
			: splitList(answer).map(normalizeDir);
	}

	/** Lifts the hand-written project file the config would replace, else starts a new tree. */
	async tree(directory: InitDirectory): Promise<TreeChoice | undefined> {
		if (!directory.hasHandWrittenProject) return { kind: "new" };
		const lift: TreeChoice = { kind: "lift", from: DEFAULT_PROJECT_FILE };
		if (!this.interactive) return lift;

		const answer = await this.promptService.select<TreeChoice["kind"]>({
			message: "Project file",
			description: `${DEFAULT_PROJECT_FILE} exists, and Rogen replaces it on every build.`,
			choices: [
				{
					value: "lift",
					label: `Lift ${DEFAULT_PROJECT_FILE} into ${DEFAULT_CONFIG_FILE}`,
					hint: "keeps its name, properties and packages",
				},
				{
					value: "new",
					label: "Start a new tree",
					hint: "packages are asked next",
				},
			],
			initialValue: "lift",
		});
		if (answer === undefined) return undefined;
		return answer === "lift" ? lift : { kind: "new" };
	}

	/** The folder Darklua writes into, which Rojo syncs from; it can't hold or lie in one of the `read` folders, the source paths and a compiler's output, or Darklua would write over what is read. */
	async syncPath(
		{ workspace }: InitDirectory,
		read: readonly string[]
	): Promise<string | undefined> {
		const placeholder = workspace.darklua.defaultSyncPath;
		if (!this.interactive) return placeholder;
		const answer = await this.promptService.text({
			message: "Sync path",
			description:
				"The folder Darklua writes into. Rojo syncs from here.",
			placeholder,
			validate: (value) => {
				const missing = required("a sync path")(value);
				if (missing) return missing;
				const dir = normalizeDir(value);
				const overlapped = read.find(
					(folder) =>
						containsPath(folder, dir) || containsPath(dir, folder)
				);
				return overlapped
					? `${dir} overlaps ${overlapped}. Darklua must write to a folder of its own.`
					: undefined;
			},
		});
		return answer === undefined ? undefined : normalizeDir(answer);
	}

	/** What the packages question offers: the package manager's folders, then the language's own. */
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

	/** The language's always-mounted folders plus the offered ones in `ticked`. */
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

	/** The folders placed in the game as they are; a run that can't ask takes the ones that start ticked. */
	async mounts(
		directory: InitDirectory,
		language: Language
	): Promise<readonly Mount[] | undefined> {
		const offered = this.offeredMounts(directory, language);
		const startsTicked = offered
			.filter(({ ticked }) => ticked)
			.map(({ path }) => path);
		// With no package manager and no package folder there is nothing to ask about, and Enter would tick nothing.
		const nothingToMount =
			directory.workspace.packageManager === undefined &&
			!offered.some(({ installed }) => installed);
		if (offered.length === 0 || nothingToMount || !this.interactive) {
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
		if (!this.interactive) {
			return { routes: starting.tickedByDefault, fallback: true };
		}

		const server = language.routeKey("server");
		const { extension } = language;
		const routes = await this.promptService.multiSelect<RouteId>({
			message: "Routes",
			description: `Where code goes. A ${server} folder, an @server marker file or a Foo@server.${extension} suffix all send code to ServerScriptService.`,
			choices: starting.options.map(({ id, key, target, hint }) => ({
				value: id,
				label: key,
				hint: `→ ${target} · ${hint}`,
			})),
			initialValues: starting.tickedByDefault,
		});
		if (routes === undefined) return undefined;
		if (routes.length === 0) return { routes, fallback: true };

		const fallback = await this.promptService.select<"shared" | "leave">({
			message: "Files that match no route",
			description:
				"Most loose modules in a feature folder are shared code.",
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
			initialValue: "shared",
		});
		return fallback && { routes, fallback: fallback === "shared" };
	}
}
