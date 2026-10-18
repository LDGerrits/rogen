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
export function oneOf(
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
export function listOf(
	given: readonly string[],
	flag: string
): readonly string[] {
	if (!given.includes(NONE)) return given;
	if (given.length > 1)
		throw new UsageError(
			`'${NONE}' can't be combined with other values of ${flag}.`
		);
	return [];
}

/** An area of a project that has a config, which a run can change. */
export interface ChangeArea {
	readonly id: string;
	readonly label: string;
	readonly hint: string;
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
	/** Whether the project being started uses Darklua, once it has been answered. */
	usesDarklua = false;

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

	/** The areas of a project that has a config to change, with what it has now; `undefined` when the user cancelled. */
	async whatToChange(
		current: string,
		areas: readonly ChangeArea[]
	): Promise<readonly string[] | undefined> {
		return this.promptService.multiSelect({
			message: "What do you want to change?",
			description: current,
			choices: areas.map(({ id, label, hint }) => ({
				value: id,
				label,
				hint,
			})),
			initialValues: [],
		});
	}

	/** The standard routes to add and to take off, from a list ticked as the config has them. */
	async changeRoutes(
		options: readonly { id: string; key: string; target: string }[],
		configured: readonly string[]
	): Promise<{ add: string[]; remove: string[] } | undefined> {
		const ticked = await this.promptService.multiSelect({
			message: "Routes",
			description:
				"Ticking adds a route, unticking takes off one that still has its standard value. Routes of your own stay.",
			choices: options.map(({ id, key, target }) => ({
				value: id,
				label: key,
				hint: `→ ${target}`,
			})),
			initialValues: configured,
		});
		return ticked === undefined
			? undefined
			: {
					add: ticked.filter((id) => !configured.includes(id)),
					remove: configured.filter((id) => !ticked.includes(id)),
				};
	}

	async changeUnmatched(
		current: "shared" | "leave",
		sharedTarget: string
	): Promise<"shared" | "leave" | undefined> {
		return this.promptService.select<"shared" | "leave">({
			message: "Files that match no route",
			description:
				"Most loose modules in a feature folder are shared code.",
			choices: [
				{ value: "shared", label: `Put them in ${sharedTarget}` },
				{
					value: "leave",
					label: "Leave them out (Rogen warns when it does)",
				},
			],
			initialValue: current,
		});
	}

	/** The source paths to add and to take off, from the list the user edits. Taking one off with scripts in it asks to confirm. */
	async changeSourcePaths(
		current: readonly string[],
		directory: InitDirectory,
		codeIn: (sourcePath: string) => Promise<readonly string[]>
	): Promise<{ add: string[]; remove: string[] } | undefined> {
		const answer = await this.promptService.text({
			message: "Source paths",
			description:
				"Folders with your scripts, relative to here. Separate several with commas.",
			placeholder: current.join(", "),
			validate: (value) => directory.sourcePathsProblem(splitList(value)),
		});
		if (answer === undefined) return undefined;
		const next = splitList(answer).map(normalizeDir);
		const remove = current.filter((entry) => !next.includes(entry));
		for (const entry of remove) {
			const files = await codeIn(entry);
			if (files.length === 0) continue;
			const sure = await this.promptService.confirm({
				message: `Stop building ${entry}?`,
				description: `${files.length === 1 ? "This file" : "These files"} would no longer be built: ${files.slice(0, 5).join(", ")}${files.length > 5 ? ", ..." : ""}.`,
				initialValue: false,
			});
			if (sure === undefined) return undefined;
			if (!sure)
				return this.changeSourcePaths(current, directory, codeIn);
		}
		return {
			add: next.filter((entry) => !current.includes(entry)),
			remove,
		};
	}

	/** Whether Darklua is on after this run, asked with its state now. */
	async changeDarklua(current: boolean): Promise<boolean | undefined> {
		return this.promptService.confirm({
			message: current
				? "Keep Darklua processing your code?"
				: "Does Darklua process your code before Rojo syncs it?",
			description:
				"Darklua writes a processed copy of your code, and Rojo syncs that copy instead.",
			initialValue: current,
		});
	}

	async changePackages(
		offered: readonly { path: string; landing: string }[]
	): Promise<readonly string[] | undefined> {
		return this.promptService.multiSelect({
			message: "Packages",
			description:
				"Folders placed in the game as they are. Rogen doesn't scan or route them.",
			choices: offered.map(({ path, landing }) => ({
				value: path,
				label: path,
				hint: `→ ${landing}`,
			})),
			initialValues: offered.map(({ path }) => path),
		});
	}

	async changePlaces(
		several: boolean
	): Promise<"several" | "add" | undefined> {
		if (several) return "add";
		return this.promptService.select<"several" | "add">({
			message: "Places",
			choices: [
				{
					value: "several",
					label: "Turn this into several places",
					hint: "adds placePaths and a first place, and moves no code",
				},
				{
					value: "add",
					label: "Add a place",
					hint: "a folder with its own rogen.json",
				},
			],
			initialValue: "several",
		});
	}

	/** The folder of a place to add. */
	async placeFolder(): Promise<string | undefined> {
		const answer = await this.promptService.text({
			message: "Place folder",
			description: "Relative to here, such as places/lobby.",
			validate: required("a folder"),
		});
		return answer === undefined ? undefined : normalizeDir(answer);
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

	/** Whether to set Rojo up; with no `manager` there is none on the machine, so a Yes installs Rokit first. A run that can't ask pins with a manager it finds and installs nothing otherwise. */
	async rojo(
		manager: string | undefined,
		installer: string,
		tools: readonly string[]
	): Promise<boolean | undefined> {
		const { rojo } = this.choices;
		if (rojo !== undefined) return rojo;
		if (!this.interactive) {
			if (manager !== undefined)
				return this.decide("rojo", true, "--rojo");
			this.decide("rojo", "not installed", "--rojo");
			return false;
		}
		return this.promptService.confirm(
			manager !== undefined
				? {
						message: `Pin ${joinedWithAnd(tools)} with ${manager}?`,
						description:
							"Rogen runs the Rojo that the toolchain file pins, so everyone who clones the repo gets the same one.",
						initialValue: true,
					}
				: {
						message: this.installMessage(tools),
						description: `Runs Rokit's installer (${installer}), then pins ${joinedWithAnd(tools)} in a rokit.toml here.`,
						initialValue: true,
					}
		);
	}

	private installMessage(tools: readonly string[]): string {
		const names = joinedWithAnd(tools.map((tool) => tool.split(" ")[0]));
		return tools.length === 1 && names === "Rojo"
			? "Rojo isn't installed, and rogen serve needs it. Install Rokit and Rojo now?"
			: `${names} ${tools.length === 1 ? "isn't" : "aren't"} installed, and the project needs ${tools.length === 1 ? "it" : "them"}. Install Rokit and ${tools.length === 1 ? "pin it" : "pin them"} now?`;
	}

	/** Whether to install Rojo's Studio plugin, which a run that can't ask leaves to the user. */
	async studioPlugin(): Promise<boolean | undefined> {
		const { plugin } = this.choices;
		if (plugin !== undefined) return plugin;
		if (!this.interactive)
			return this.decide("plugin", false, "--studio-plugin");
		return this.promptService.confirm({
			message: "Install Rojo's Studio plugin?",
			description:
				"Studio needs it to connect to rogen serve. It is installed into Studio's plugins folder.",
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

	/** Whether a new project is several places; a `places` folder here makes it the default. */
	async places(directory: InitDirectory): Promise<boolean | undefined> {
		const given = this.choices.places;
		if (given !== undefined) return given;
		if (this.choices.sourcePaths !== undefined) return false;
		const several =
			directory.has("places") &&
			directory.layout.codeFolders.every((folder) => folder === "places");
		if (!this.interactive)
			return this.decide("places", several, "--places");
		const answer = await this.promptService.select<"one" | "several">({
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
					hint: "places/shared holds the shared code, places/game the first place",
				},
			],
			initialValue: several ? "several" : "one",
		});
		return answer === undefined ? undefined : answer === "several";
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
