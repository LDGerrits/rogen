import { UsageError } from "../../base/errors.js";
import { containsPath, normalizeDir } from "../../base/path.js";
import { joinedClosestFirst, joinedWithAnd } from "../../base/strings.js";
import { PromptService } from "../../platform/prompt/prompt-service.js";
import { DEFAULT_CONFIG_FILE, DEFAULT_PROJECT_FILE } from "../config/config.js";
import { EnclosingConfigs } from "../config/config-service.js";
import { Language, Mount, MountCandidate } from "../toolchain/toolchain.js";
import { HOOK_SCRIPT_FILE } from "./agent/coding-agent.js";
import { InitDirectory } from "./init-directory.js";
import { DerivedRoutes } from "./derived-routes.js";
import { RouteId, StartingRoutes } from "./starting-routes.js";
import { InitChoices, InitDecision, InitKind } from "./init-service.js";
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

export interface AdditionOption<T> {
	readonly id: string;
	/** The flag that asks for this addition. */
	readonly flag: string;
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

/** Everything `init` asks. A question the user answered with a flag is not asked, and one a run that can't ask takes the default of is written to `decided`. A flag with a value that doesn't fit throws a `UsageError`. */
export class InitQuestions {
	readonly decided: InitDecision[] = [];

	constructor(
		private readonly promptService: PromptService,
		readonly interactive: boolean,
		readonly choices: InitChoices = {}
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

	async startNestedProject({
		directory,
		fileNames,
	}: EnclosingConfigs): Promise<boolean | undefined> {
		if (this.choices.nested) return true;
		if (!this.interactive) return false;
		return this.promptService.confirm({
			message: `${directory} already has ${fileNames.join(", ")}. Start a separate project here anyway?`,
			description:
				"This folder may already be part of that project, and a project here would then be built twice.",
			initialValue: false,
		});
	}

	async placeListing(
		glob: string,
		folder: string
	): Promise<string | undefined> {
		const given = this.choices.placeListing;
		if (given) return given === "glob" ? glob : folder;
		if (!this.interactive) {
			this.decide("placeListing", "glob", "--place-listing");
			return glob;
		}
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

	/** The place IDs the server of a place is for; none when the place isn't published yet. */
	async placeIds(place: string): Promise<readonly number[] | undefined> {
		const given = this.choices.placeIds;
		if (given !== undefined)
			return InitQuestions.distinct(
				listOf(given, "--place-id").map((id) =>
					InitQuestions.toPlaceId(id)
				)
			);
		if (!this.interactive) {
			this.decide("placeIds", [], "--place-id");
			return [];
		}
		const answer = await this.promptService.text({
			message: "Place ID",
			description: `The published ${place} place's ID, so that a Studio on another place refuses to connect to its port. Leave empty if it isn't published yet. Separate several with commas.`,
			validate: (value) => {
				const bad = splitList(value).find(
					(id) => !InitQuestions.isPlaceId(id)
				);
				return bad === undefined
					? undefined
					: `'${bad}' is not a place ID, a whole number above 0.`;
			},
		});
		return answer === undefined
			? undefined
			: InitQuestions.distinct(
					splitList(answer).map((id) => InitQuestions.toPlaceId(id))
				);
	}

	private static distinct(ids: readonly number[]): number[] {
		return [...new Set(ids)];
	}

	private static isPlaceId(value: string): boolean {
		return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
	}

	private static toPlaceId(value: string): number {
		if (!InitQuestions.isPlaceId(value))
			throw new UsageError(
				`'${value}' is not a place ID.`,
				"A place ID is a whole number above 0, as Roblox shows it in the place's URL."
			);
		return Number(value);
	}

	async whatToAdd<T>(
		configFile: string,
		options: readonly AdditionOption<T>[]
	): Promise<T | undefined> {
		const [first] = options;
		if (!this.interactive) {
			this.decide("add", first.id, first.flag);
			return first.addition;
		}
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

	async addRojoPin(fileName: string): Promise<boolean | undefined> {
		if (this.choices.rojoPin !== undefined) return this.choices.rojoPin;
		if (!this.interactive)
			return this.decide("rojoPin", false, "--rojo-pin");
		return this.promptService.confirm({
			message: `Pin Rojo in ${fileName}?`,
			description:
				"Rogen runs the Rojo that the toolchain file pins, so everyone who clones the repo gets the same one.",
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

	async language({
		workspace,
	}: InitDirectory): Promise<Language | undefined> {
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

	darklua({ workspace }: InitDirectory): Promise<boolean | undefined> {
		const found = workspace.darkluaConfig !== undefined;
		if (this.choices.darklua !== undefined)
			return Promise.resolve(this.choices.darklua);
		if (!this.interactive)
			return Promise.resolve(this.decide("darklua", found, "--darklua"));
		return this.promptService.confirm({
			message: "Does Darklua process your code before Rojo syncs it?",
			description:
				"Darklua writes a processed copy of your code, and Rojo syncs that copy instead.",
			hint: found ? `found ${workspace.darkluaConfig}` : undefined,
			initialValue: found,
		});
	}

	async sourcePaths(
		directory: InitDirectory,
		language: Language
	): Promise<string[] | undefined> {
		const placeholder = directory.defaultSourcePath(language);
		const { compiler } = language;
		const copy = language.copy.sourcePath;
		const checked = (entries: readonly string[]): string | undefined => {
			const problem = directory.sourcePathsProblem(entries);
			if (problem) return problem;
			return compiler && entries.length > 1
				? copy?.severalProblem
				: undefined;
		};
		const given = this.choices.sourcePaths;
		if (given !== undefined) {
			const problem = checked(given);
			if (problem) throw new UsageError(problem);
			return given.map(normalizeDir);
		}
		if (!this.interactive)
			return this.decide("sourcePaths", [placeholder], "--source-path");

		const answer = await this.promptService.text({
			message: compiler ? "Source path" : "Source paths",
			description: compiler
				? copy?.description
				: "Folders with your scripts, relative to here. Separate several with commas.",
			hint: directory.otherCodeFoldersHint(placeholder),
			placeholder,
			validate: (value) => checked(splitList(value)),
		});
		return answer === undefined
			? undefined
			: splitList(answer).map(normalizeDir);
	}

	async tree(directory: InitDirectory): Promise<TreeChoice | undefined> {
		const given = this.choices.projectFile;
		if (!directory.hasHandWrittenProject) {
			if (given === "lift")
				throw new UsageError(
					`${DEFAULT_PROJECT_FILE} doesn't exist, so there is nothing to lift.`
				);
			return { kind: "new" };
		}
		const lift: TreeChoice = { kind: "lift", from: DEFAULT_PROJECT_FILE };
		if (given !== undefined)
			return given === "lift" ? lift : { kind: "new" };
		if (!this.interactive) {
			this.decide("projectFile", "lift", "--project-file");
			return lift;
		}

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

	async syncPath(
		{ workspace }: InitDirectory,
		read: readonly string[]
	): Promise<string | undefined> {
		const placeholder = workspace.darklua.defaultSyncPath;
		const checked = (value: string): string | undefined => {
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
		};
		const given = this.choices.syncPath;
		if (given !== undefined) {
			const problem = checked(given);
			if (problem) throw new UsageError(problem);
			return normalizeDir(given);
		}
		if (!this.interactive)
			return this.decide("syncPath", placeholder, "--sync-path");
		const answer = await this.promptService.text({
			message: "Sync path",
			description:
				"The folder Darklua writes into. Rojo syncs from here.",
			placeholder,
			validate: checked,
		});
		return answer === undefined ? undefined : normalizeDir(answer);
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
		if (!this.interactive) {
			this.decide("unmatched", "shared", "--unmatched");
			return { routes, fallback: true };
		}

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
