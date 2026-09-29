import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import {
	PromptChoice,
	PromptService,
} from "../../platform/prompt/prompt-service.js";
import {
	CONFIG_SUFFIX,
	DEFAULT_CONFIG_STEM,
} from "../config/config-discovery.js";
import { DetectedWorkspace, Language } from "./detect-workspace.js";
import {
	BaseConfig,
	DEFAULT_CONFIG_FILE,
	PlaceChoices,
	placeFileNames,
	variantFileNames,
} from "./init-place.js";
import {
	TemplateMount,
	defaultMounts,
	offeredMounts,
	selectMounts,
} from "./init-mounts.js";
import {
	DARKLUA_SYNC_DIR,
	InitChoices,
	compiledDirOf,
	configFileNames,
	existingFileDiagnostics,
	outputFileNames,
	parseInitName,
	placeFolder,
	sourceStemOf,
	syncDirFor,
} from "./init-plan.js";
import {
	defaultRootDir,
	normalizeRootDir,
	otherCodeFoldersHint,
	parseRootDirs,
	placeFolderProblem,
	rootDirsProblem,
} from "./init-root-dirs.js";
import {
	TEMPLATE_FILE,
	TemplateChoice,
	defaultTemplateChoice,
	handWrittenProjectFiles,
} from "./init-template.js";
import {
	RouteId,
	routeKey,
	routeOptions,
	sharedTarget,
} from "./starting-routes.js";

export interface InitContext {
	readonly workspace: DetectedWorkspace;
	readonly directory: string;
	/** The names of the entries already in `directory`. */
	readonly existingFiles: ReadonlySet<string>;
	/** The resolved `default.rogen.json`, when it exists. */
	readonly base?: Result<BaseConfig, Diagnostic[]>;
}

export type InitAnswers =
	| { readonly kind: "project"; readonly choices: InitChoices }
	| { readonly kind: "place"; readonly choices: PlaceChoices }
	| { readonly kind: "variant"; readonly name: string };

type Layout = "one" | "several";
type Addition = "place" | "variant" | "separate";

const required = (what: string) => (value: string) =>
	value.trim() === "" ? `Enter ${what}.` : undefined;

const splitList = (value: string): string[] =>
	value
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");

/**
 * Asks what to add when `default.rogen.json` exists, and otherwise for a new
 * project. Resolves to `ok(undefined)` when the user cancels, and to `err` as
 * soon as a file the answers would write already exists. `name` skips the name
 * question.
 */
export async function askInit(
	promptService: PromptService,
	context: InitContext,
	name?: string
): Promise<Result<InitAnswers | undefined, Diagnostic[]>> {
	const { workspace, directory, existingFiles } = context;
	if (!existingFiles.has(DEFAULT_CONFIG_FILE)) {
		return asProject(await askInitChoices(promptService, context, name));
	}

	const addition = await promptService.select<Addition>({
		message: `${DEFAULT_CONFIG_FILE} exists. What do you want to add?`,
		choices: [
			{
				value: "place",
				label: "A place",
				hint: "another Roblox place that shares default's code",
			},
			{
				value: "variant",
				label: "A variant of default",
				hint: "the same game with other tags or excludes",
			},
			{
				value: "separate",
				label: "A separate config",
				hint: "answers every question again",
			},
		],
		initialValue: "place",
	});
	if (addition === undefined) return ok(undefined);
	if (addition === "separate") {
		return asProject(await askInitChoices(promptService, context, name));
	}

	const filesFor = (candidate: string) =>
		addition === "place"
			? placeFileNames(candidate, workspace.language, workspace.darklua)
			: variantFileNames(candidate);
	if (name) {
		const conflicts = existingFileDiagnostics(
			filesFor(name),
			directory,
			existingFiles
		);
		if (conflicts.length > 0) return err(conflicts);
	}

	if (addition === "variant") {
		const variant =
			name ??
			(await askName(promptService, existingFiles, {
				message: "Variant name",
				description: `Writes <name>.rogen.json, which extends ${DEFAULT_CONFIG_FILE}.`,
				filesFor,
			}));
		return ok(
			variant === undefined
				? undefined
				: { kind: "variant", name: variant }
		);
	}

	const choices = await askPlaceChoices(
		promptService,
		context,
		filesFor,
		name
	);
	return ok(choices && { kind: "place", choices });
}

const asProject = (
	asked: Result<InitChoices | undefined, Diagnostic[]>
): Result<InitAnswers | undefined, Diagnostic[]> =>
	asked.isErr()
		? asked
		: ok(asked.value && { kind: "project", choices: asked.value });

/**
 * The new project questions. Resolves like `askInit`. Asks the layout on a
 * first run with no `name`, and a name when `default.rogen.json` exists.
 */
export async function askInitChoices(
	promptService: PromptService,
	context: InitContext,
	name?: string
): Promise<Result<InitChoices | undefined, Diagnostic[]>> {
	const { workspace, directory, existingFiles } = context;
	const firstRun = !existingFiles.has(DEFAULT_CONFIG_FILE);

	let layout: Layout = "one";
	if (firstRun && name === undefined) {
		const found = workspace.places.map(placeFolder).join(", ");
		const answer = await promptService.select<Layout>({
			message: "What are you setting up?",
			choices: [
				{ value: "one", label: "One place" },
				{
					value: "several",
					label: "Several places that share code",
					hint: found ? `found ${found}` : undefined,
				},
			],
			initialValue: workspace.places.length > 0 ? "several" : "one",
		});
		if (answer === undefined) return ok(undefined);
		layout = answer;
	}

	const chosenName =
		name ??
		(firstRun
			? DEFAULT_CONFIG_STEM
			: await askConfigName(promptService, existingFiles));
	if (chosenName === undefined) return ok(undefined);

	const language = await promptService.select<Language>({
		message: "Language",
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

	const rootDirs = await askRootDirs(
		promptService,
		workspace,
		language,
		layout
	);
	if (rootDirs === undefined) return ok(undefined);

	const outputs = outputFileNames(chosenName, language, darklua);
	const template = await askTemplate(promptService, existingFiles, outputs);
	if (template === undefined) return ok(undefined);

	let syncDir = syncDirFor(language, darklua, workspace);
	if (darklua) {
		const answer = await promptService.text({
			message: "Sync dir",
			description:
				"The folder Darklua writes into. Rojo syncs from here.",
			placeholder: DARKLUA_SYNC_DIR,
			validate: required("a sync dir"),
		});
		if (answer === undefined) return ok(undefined);
		syncDir = normalizeRootDir(answer);
	}

	const mounts =
		template.kind === "use"
			? []
			: await askMounts(promptService, context, language);
	if (mounts === undefined) return ok(undefined);

	const routes = await askRoutes(promptService, language);
	if (routes === undefined) return ok(undefined);

	let places: readonly string[] = [];
	if (layout === "several") {
		const reserved = new Set([
			...configFileNames(chosenName, language, darklua),
			...outputs,
			TEMPLATE_FILE,
		]);
		const answer = await askPlaces(promptService, context, {
			rootDirs,
			filesFor: (place) => placeFileNames(place, language, darklua),
			reserved,
		});
		if (answer === undefined) return ok(undefined);
		places = answer;
	}

	return ok({
		name: chosenName,
		language,
		darklua,
		rootDirs,
		...(syncDir && { syncDir }),
		...(language === "roblox-ts" && { outDir: compiledDirOf(workspace) }),
		template,
		mounts,
		routes: routes.routes,
		fallback: routes.fallback,
		places,
	});
}

async function askRootDirs(
	promptService: PromptService,
	workspace: DetectedWorkspace,
	language: Language,
	layout: Layout
): Promise<string[] | undefined> {
	const placeholder = defaultRootDir(workspace, language);
	const robloxTs = language === "roblox-ts";
	const answer = await promptService.text({
		message: robloxTs ? "Root dir" : "Root dirs",
		description: robloxTs
			? "The folder roblox-ts compiles (rootDir in tsconfig.json)."
			: layout === "several"
				? "Folders with the code every place shares, relative to here. Separate several with commas."
				: "Folders with your scripts, relative to here. Separate several with commas.",
		hint: otherCodeFoldersHint(workspace, placeholder),
		placeholder,
		validate: (value) => {
			const entries = splitList(value);
			const problem = rootDirsProblem(entries);
			if (problem) return problem;
			return robloxTs && entries.length > 1
				? "roblox-ts compiles one folder. For code per place, set up several places."
				: undefined;
		},
	});
	return answer === undefined ? undefined : parseRootDirs(answer);
}

async function askTemplate(
	promptService: PromptService,
	existingFiles: ReadonlySet<string>,
	outputs: readonly string[]
): Promise<TemplateChoice | undefined> {
	const candidates = handWrittenProjectFiles(existingFiles);
	if (existingFiles.has(TEMPLATE_FILE) || candidates.length === 0) {
		return { kind: "new" };
	}

	const replaced = candidates.filter((file) => outputs.includes(file));
	const others = candidates.filter((file) => !outputs.includes(file));
	const initial = defaultTemplateChoice(existingFiles, outputs);
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
	const answer = await promptService.select({
		message: "Template",
		description:
			replaced.length > 0
				? `${replaced[0]} exists, and Rogen replaces it on every build.`
				: "The Rojo project file Rogen builds on top of.",
		choices,
		initialValue: initial.kind === "copy" ? `copy:${initial.from}` : "new",
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

async function askMounts(
	promptService: PromptService,
	{ workspace, existingFiles }: InitContext,
	language: Language
): Promise<readonly TemplateMount[] | undefined> {
	const offered = offeredMounts(workspace, language);
	if (offered.length === 0 || existingFiles.has(TEMPLATE_FILE)) {
		return defaultMounts(workspace, language);
	}

	const ticked = await promptService.multiSelect({
		message: "Packages",
		description:
			language === "roblox-ts"
				? "Folders placed in the game as they are. Rogen doesn't scan or route them. include and @rbxts are always mounted."
				: "Folders placed in the game as they are. Rogen doesn't scan or route them.",
		choices: offered.map(({ path, installed, landing }) => ({
			value: path,
			label: path,
			hint: `→ ${landing}${installed ? "" : " · not installed yet"}`,
		})),
		initialValues: offered
			.filter(({ ticked }) => ticked)
			.map(({ path }) => path),
	});
	return ticked && selectMounts(workspace, language, ticked);
}

async function askRoutes(
	promptService: PromptService,
	language: Language
): Promise<{ routes: readonly RouteId[]; fallback: boolean } | undefined> {
	const options = routeOptions(language);
	const server = routeKey("server", language);
	const extension = language === "roblox-ts" ? "ts" : "luau";
	const routes = await promptService.multiSelect<RouteId>({
		message: "Routes",
		description: `Where code goes. A ${server} folder, a .server marker file or a Foo.server.${extension} suffix all send code to ServerScriptService.`,
		choices: options.map(({ id, key, target, hint }) => ({
			value: id,
			label: key,
			hint: `→ ${target} · ${hint}`,
		})),
		initialValues: options
			.filter(({ ticked }) => ticked)
			.map(({ id }) => id),
	});
	if (routes === undefined) return undefined;
	if (routes.length === 0) return { routes, fallback: true };

	const fallback = await promptService.select<"shared" | "leave">({
		message: "Files that match no route",
		description: "Most loose modules in a feature folder are shared code.",
		choices: [
			{
				value: "shared",
				label: `Put them in ${sharedTarget(language)}`,
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

interface PlacesQuestion {
	/** Default's root dirs, which every place folder joins. */
	readonly rootDirs: readonly string[];
	readonly filesFor: (name: string) => readonly string[];
	/** Files the project itself writes, which no place may. */
	readonly reserved: ReadonlySet<string>;
}

async function askPlaces(
	promptService: PromptService,
	{ workspace, existingFiles }: InitContext,
	{ rootDirs, filesFor, reserved }: PlacesQuestion
): Promise<string[] | undefined> {
	const answer = await promptService.text({
		message: "Places",
		description:
			"Each place gets <name>.rogen.json, and its own code goes in places/<name>. Separate several with commas.",
		placeholder:
			workspace.places.length > 0 ? workspace.places.join(", ") : "lobby",
		validate: (value) => {
			const names = splitList(value);
			if (names.length === 0) return "Enter at least one place.";
			for (const [index, place] of names.entries()) {
				const parsed = parseInitName([place]);
				if (parsed.isErr()) return parsed.error.message;
				if (names.indexOf(place) !== index) {
					return `${place} is listed twice.`;
				}
				const clash = filesFor(place).find(
					(file) => existingFiles.has(file) || reserved.has(file)
				);
				if (clash) {
					return existingFiles.has(clash)
						? `${clash} already exists.`
						: `${clash} is written for ${DEFAULT_CONFIG_STEM}; pick another name.`;
				}
				const problem = placeFolderProblem(
					rootDirs,
					placeFolder(place)
				);
				if (problem) return problem;
			}
			return undefined;
		},
	});
	return answer === undefined ? undefined : splitList(answer);
}

interface NameQuestion {
	readonly message: string;
	readonly description: string;
	/** The files a config of this name would write. */
	readonly filesFor: (name: string) => readonly string[];
}

function askName(
	promptService: PromptService,
	existingFiles: ReadonlySet<string>,
	{ message, description, filesFor }: NameQuestion
): Promise<string | undefined> {
	return promptService
		.text({
			message,
			description,
			validate: (value) => {
				const trimmed = value.trim();
				if (trimmed === "") return "Enter a name.";
				const parsed = parseInitName([trimmed]);
				if (parsed.isErr()) return parsed.error.message;
				const taken = filesFor(trimmed).find((file) =>
					existingFiles.has(file)
				);
				return taken && `${taken} already exists.`;
			},
		})
		.then((answer) => answer?.trim());
}

function askConfigName(
	promptService: PromptService,
	existingFiles: ReadonlySet<string>
): Promise<string | undefined> {
	return askName(promptService, existingFiles, {
		message: "Config name",
		description: "Writes <name>.rogen.json.",
		filesFor: (name) => [
			`${name}${CONFIG_SUFFIX}`,
			`${sourceStemOf(name)}${CONFIG_SUFFIX}`,
		],
	});
}

async function askPlaceChoices(
	promptService: PromptService,
	{ existingFiles, base }: InitContext,
	filesFor: (name: string) => readonly string[],
	name?: string
): Promise<PlaceChoices | undefined> {
	const placeName =
		name ??
		(await askName(promptService, existingFiles, {
			message: "Place name",
			description: "Writes <name>.rogen.json.",
			filesFor,
		}));
	if (placeName === undefined) return undefined;

	const folder = await promptService.text({
		message: "Place folder",
		description:
			"Holds this place's own code. It's added to default's root dirs.",
		placeholder: placeFolder(placeName),
		validate: (value) =>
			required("a folder")(value) ??
			(base?.isOk()
				? placeFolderProblem(base.value.rootDirs, value)
				: undefined),
	});
	return folder === undefined
		? undefined
		: { name: placeName, folder: normalizeRootDir(folder) };
}
