import { normalizeDir } from "../../base/path.js";
import {
	PromptChoice,
	PromptService,
} from "../../platform/prompt/prompt-service.js";
import { DEFAULT_CONFIG_STEM, configFileName } from "../config/config.js";
import { Language, Mount, MountCandidate } from "../toolchain/toolchain.js";
import { ConfigSet, TEMPLATE_FILE } from "./config-set.js";
import { BaseConfig, InitDirectory } from "./init-directory.js";
import { RouteId, StartingRoutes } from "./starting-routes.js";
import { TemplateChoice } from "./starter-template.js";

export type Layout = "one" | "several";
export type Addition = "place" | "extending" | "separate";

export interface NameQuestion {
	readonly message: string;
	readonly description: string;
	/** The files a config of this name would write. */
	readonly filesFor: (name: string) => readonly string[];
}

export interface PlacesQuestion {
	/** Default's root dirs, which every place folder joins. */
	readonly rootDirs: readonly string[];
	readonly filesFor: (name: string) => readonly string[];
	/** Files the project itself writes, which no place may. */
	readonly reserved: ReadonlySet<string>;
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
	constructor(private readonly promptService: PromptService) {}

	private get interactive(): boolean {
		return this.promptService.isInteractive;
	}

	/** What to add beside `default.rogen.json`; a run that can't ask adds a place, as Enter does. */
	async whatToAdd(): Promise<Addition | undefined> {
		if (!this.interactive) return "place";
		return this.promptService.select<Addition>({
			message: `${ConfigSet.DEFAULT_FILE} exists. What do you want to add?`,
			choices: [
				{
					value: "place",
					label: "A place",
					hint: "another Roblox place that shares default's code",
				},
				{
					value: "extending",
					label: "A config that extends default",
					hint: "the same game with other variants or excludes",
				},
				{
					value: "separate",
					label: "A separate config",
					hint: "answers every question again",
				},
			],
			initialValue: "place",
		});
	}

	/** Several places when the workspace already has a `places` folder. */
	async layout({ workspace }: InitDirectory): Promise<Layout | undefined> {
		const initial: Layout = workspace.places.length > 0 ? "several" : "one";
		if (!this.interactive) return initial;

		const found = workspace.places.map(ConfigSet.placeFolderOf).join(", ");
		return this.promptService.select<Layout>({
			message: "What are you setting up?",
			choices: [
				{ value: "one", label: "One place" },
				{
					value: "several",
					label: "Several places that share code",
					hint: found ? `found ${found}` : undefined,
				},
			],
			initialValue: initial,
		});
	}

	/** A name has no default, so a run that can't ask stops here. */
	async name(
		directory: InitDirectory,
		{ message, description, filesFor }: NameQuestion
	): Promise<string | undefined> {
		if (!this.interactive) return undefined;
		const answer = await this.promptService.text({
			message,
			description,
			validate: (value) => {
				const trimmed = value.trim();
				if (trimmed === "") return "Enter a name.";
				const parsed = ConfigSet.parseName([trimmed]);
				if (parsed.isErr()) return parsed.error.message;
				const taken = filesFor(trimmed).find((file) =>
					directory.has(file)
				);
				return taken && `${taken} already exists.`;
			},
		});
		return answer?.trim();
	}

	/** The name of a config added beside `default`. */
	configName(directory: InitDirectory): Promise<string | undefined> {
		return this.name(directory, {
			message: "Config name",
			description: "Writes <name>.rogen.json.",
			filesFor: (name) => [
				configFileName(name),
				configFileName(ConfigSet.syncStemOf(name)),
			],
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

	async rootDirs(
		directory: InitDirectory,
		language: Language,
		layout: Layout
	): Promise<string[] | undefined> {
		const placeholder = directory.defaultRootDir(language);
		if (!this.interactive) return [placeholder];

		const { compiler } = language;
		const copy = language.copy.rootDir;
		const answer = await this.promptService.text({
			message: compiler ? "Root dir" : "Root dirs",
			description: compiler
				? copy?.description
				: layout === "several"
					? "Folders with the code every place shares, relative to here. Separate several with commas."
					: "Folders with your scripts, relative to here. Separate several with commas.",
			hint: directory.otherCodeFoldersHint(placeholder),
			placeholder,
			validate: (value) => {
				const entries = splitList(value);
				const problem = directory.rootDirsProblem(entries);
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

	/** Copies the hand-written project file a new config would replace, else starts a new template. */
	async template(
		directory: InitDirectory,
		outputs: readonly string[]
	): Promise<TemplateChoice | undefined> {
		const candidates = ConfigSet.handWrittenProjectFiles(directory);
		if (directory.has(TEMPLATE_FILE) || candidates.length === 0) {
			return { kind: "new" };
		}

		const replaced = candidates.filter((file) => outputs.includes(file));
		const others = candidates.filter((file) => !outputs.includes(file));
		const initial: TemplateChoice =
			replaced.length > 0
				? { kind: "copy", from: replaced[0] }
				: { kind: "new" };
		if (!this.interactive) return initial;

		const choices: PromptChoice<string>[] = [
			...replaced.map((file) => ({
				value: `copy:${file}`,
				label: `Copy ${file} to ${TEMPLATE_FILE}`,
				hint: "keeps its name, properties and packages",
			})),
			...others.map((file) => ({
				value: `use:${file}`,
				label: `Use ${file}`,
			})),
			{
				value: "new",
				label: `Start a new ${TEMPLATE_FILE}`,
				hint: "packages are asked next",
			},
		];
		const answer = await this.promptService.select({
			message: "Template",
			description:
				replaced.length > 0
					? `${replaced[0]} exists, and Rogen replaces it on every build.`
					: "The Rojo project file Rogen builds on top of.",
			choices,
			initialValue:
				initial.kind === "copy" ? `copy:${initial.from}` : "new",
		});
		if (answer === undefined) return undefined;
		if (answer.startsWith("copy:")) {
			return { kind: "copy", from: answer.slice("copy:".length) };
		}
		if (answer.startsWith("use:")) {
			return { kind: "use", file: answer.slice("use:".length) };
		}
		return { kind: "new" };
	}

	/** The folder Darklua writes into, which Rojo syncs from. */
	async syncDir({ workspace }: InitDirectory): Promise<string | undefined> {
		const placeholder = workspace.darklua.defaultSyncDir;
		if (!this.interactive) return placeholder;
		const answer = await this.promptService.text({
			message: "Sync dir",
			description:
				"The folder Darklua writes into. Rojo syncs from here.",
			placeholder,
			validate: required("a sync dir"),
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

	/** The folders placed in the game as they are; the ones that start ticked unless a template is already there. */
	async mounts(
		directory: InitDirectory,
		language: Language
	): Promise<readonly Mount[] | undefined> {
		const offered = this.offeredMounts(directory, language);
		const startsTicked = offered
			.filter(({ ticked }) => ticked)
			.map(({ path }) => path);
		if (
			offered.length === 0 ||
			directory.has(TEMPLATE_FILE) ||
			!this.interactive
		) {
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
		language: Language
	): Promise<{ routes: readonly RouteId[]; fallback: boolean } | undefined> {
		if (!this.interactive) {
			return { routes: StartingRoutes.DEFAULT, fallback: true };
		}

		const starting = new StartingRoutes(language);
		const server = language.routeKey("server");
		const { extension } = language;
		const routes = await this.promptService.multiSelect<RouteId>({
			message: "Routes",
			description: `Where code goes. A ${server} folder, a .server marker file or a Foo@server.${extension} suffix all send code to ServerScriptService.`,
			choices: starting.options.map(({ id, key, target, hint }) => ({
				value: id,
				label: key,
				hint: `→ ${target} · ${hint}`,
			})),
			initialValues: starting.options
				.filter(({ ticked }) => ticked)
				.map(({ id }) => id),
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
					label: `Put them in ${starting.sharedTarget}`,
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

	/** The places set up alongside, the ones the workspace already has unless told otherwise. */
	async places(
		directory: InitDirectory,
		{ rootDirs, filesFor, reserved }: PlacesQuestion
	): Promise<string[] | undefined> {
		const found = directory.workspace.places;
		if (!this.interactive) return [...found];

		const answer = await this.promptService.text({
			message: "Places",
			description:
				"Each place gets <name>.rogen.json, and its own code goes in places/<name>. Separate several with commas.",
			placeholder: found.length > 0 ? found.join(", ") : "lobby",
			validate: (value) => {
				const names = splitList(value);
				if (names.length === 0) return "Enter at least one place.";
				for (const [index, place] of names.entries()) {
					const parsed = ConfigSet.parseName([place]);
					if (parsed.isErr()) return parsed.error.message;
					if (names.indexOf(place) !== index) {
						return `${place} is listed twice.`;
					}
					const clash = filesFor(place).find(
						(file) => directory.has(file) || reserved.has(file)
					);
					if (clash) {
						return directory.has(clash)
							? `${clash} already exists.`
							: `${clash} is written for ${DEFAULT_CONFIG_STEM}; pick another name.`;
					}
					const problem = directory.placeFolderProblem(
						rootDirs,
						ConfigSet.placeFolderOf(place)
					);
					if (problem) return problem;
				}
				return undefined;
			},
		});
		return answer === undefined ? undefined : splitList(answer);
	}

	/** Where a place keeps its own code: `places/<name>` unless told otherwise. */
	async placeFolder(
		directory: InitDirectory,
		base: BaseConfig,
		placeName: string
	): Promise<string | undefined> {
		const placeholder = ConfigSet.placeFolderOf(placeName);
		if (!this.interactive) return placeholder;
		const folder = await this.promptService.text({
			message: "Place folder",
			description:
				"Holds this place's own code. It's added to default's root dirs.",
			placeholder,
			validate: (value) =>
				required("a folder")(value) ??
				directory.placeFolderProblem(base.rootDirs, value),
		});
		return folder === undefined ? undefined : normalizeDir(folder);
	}
}
