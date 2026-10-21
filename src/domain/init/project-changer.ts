import path from "path";
import { UsageError } from "../../base/errors.js";
import { isObject } from "../../base/objects.js";
import { containsPosix, normalizeDir } from "../../base/path.js";
import { joinedWithAnd } from "../../base/strings.js";
import { Result, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { ROGEN_BLOCK } from "../config/config.js";
import { DeclaredKeys } from "../config/declared-keys.js";
import { Language } from "../toolchain/toolchain.js";
import { CodeFinder } from "./code-finder.js";
import {
	ConfigChanges,
	ChangePlan,
	ChangeRequest,
	mountedIn,
} from "./config-changes.js";
import { ConfigEdit } from "./config-edit.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import { ChangeArea, InitQuestions, listOf } from "./init-questions.js";
import { Setup } from "./setup.js";
import { StartingRoutes } from "./starting-routes.js";

/** The flags that change a project that has a config. */
const CHANGE_FLAGS: readonly (readonly [string, string])[] = [
	["routes", "--route"],
	["unroutes", "--no-route"],
	["unmatched", "--unmatched"],
	["sourcePaths", "--source-path"],
	["unsourcePaths", "--no-source-path"],
	["darklua", "--darklua"],
	["compiledPath", "--compiled-path"],
	["packages", "--package"],
];

const NEW_PROJECT_FLAGS: readonly (readonly [string, string, string])[] = [
	[
		"language",
		"--language",
		"The language decides the starter files and the compiler, and changing it means changing the code.",
	],
	[
		"kind",
		"--kind",
		"The kind is what a new project starts as, and this one has started.",
	],
	[
		"skipGit",
		"--skip-git",
		"The git steps are part of starting a project, and this one has started.",
	],
	[
		"projectFile",
		"--project-file",
		"A project file is lifted or replaced when a project starts.",
	],
	[
		"sample",
		"--sample",
		"The sample is written when a project starts, in a folder with no code.",
	],
];

const label = (value: readonly string[], none: string): string =>
	value.length > 0 ? joinedWithAnd(value) : none;

/** Changes the config of a project that has one: what the flags name, or what the user picks from the areas that have something to change. */
export class ProjectChanger {
	private constructor(
		private readonly fileSystemService: FileReader,
		private readonly directory: InitDirectory,
		private readonly questions: InitQuestions,
		private readonly edit: ConfigEdit,
		private readonly language: Language,
		private readonly routed: boolean
	) {}

	/** `undefined` when the config can't be read as JSON, which a change can't be made to. */
	static async of(
		fileSystemService: FileReader,
		directory: InitDirectory,
		questions: InitQuestions
	): Promise<ProjectChanger | undefined> {
		const fileName = directory.configFiles[0];
		const edit = ConfigEdit.of(
			fileName,
			await fileSystemService.readFile(
				path.join(directory.path, fileName)
			)
		);
		if (!edit) return undefined;
		const root = edit.valueAt(["tree"]);
		const routed =
			!isObject(root) ||
			root.$className === "DataModel" ||
			(root.$className === undefined && root.$path === undefined);
		return new ProjectChanger(
			fileSystemService,
			directory,
			questions,
			edit,
			directory.workspace.language,
			routed
		);
	}

	/** A flag that only a new project takes is an error here, with the reason. */
	static rejectNewProjectFlags(
		questions: InitQuestions,
		configFile: string
	): void {
		for (const [key, flag, why] of NEW_PROJECT_FLAGS)
			if (
				questions.choices[key as keyof typeof questions.choices] !==
				undefined
			)
				throw new UsageError(
					`${flag} is for a new project, and ${configFile} exists. ${why}`
				);
	}

	static hasFlags(questions: InitQuestions): boolean {
		return CHANGE_FLAGS.some(
			([key]) =>
				questions.choices[key as keyof typeof questions.choices] !==
				undefined
		);
	}

	private changes(): ConfigChanges {
		return new ConfigChanges(
			this.fileSystemService,
			this.directory,
			this.edit,
			this.language,
			this.routed
		);
	}

	/** The setup that makes the changes `request` asks for, once it is known. */
	setup(
		request: () => Promise<ChangeRequest | undefined>
	): Setup<ChangePlan> {
		const changes = this.changes();
		return {
			ask: async (): Promise<
				Result<ChangePlan | undefined, Diagnostic[]>
			> => {
				const asked = await request();
				if (asked?.darklua === true) this.questions.usesDarklua = true;
				return ok(asked && (await changes.apply(asked)));
			},
			plan: (plan, builder) => ProjectChanger.pour(plan, builder),
		};
	}

	private static pour(plan: ChangePlan, builder: InitPlanBuilder): void {
		if (plan.config) builder.editConfig(plan.config);
		for (const file of plan.files) builder.addFile(file);
		for (const directory of plan.directories)
			builder.addDirectory(directory);
		for (const note of plan.notes) builder.addNote(note);
		for (const warning of plan.warnings) builder.addWarning(warning);
		builder.addSetup(...plan.setup);
		builder.addRun(...plan.run);
		builder.addEdit(...plan.edits);
	}

	/** What the flags name, each as the change it makes. */
	async fromFlags(): Promise<ChangeRequest> {
		const { choices } = this.questions;
		const list = (given: readonly string[] | undefined, flag: string) => {
			if (given === undefined) return undefined;
			const values = listOf(given, flag);
			if (values.length === 0)
				throw new UsageError(
					`${flag} none would change nothing here.`,
					flag === "--route"
						? "Take routes off with --no-route <id>."
						: "Take a folder off with its own flag."
				);
			return values;
		};
		if (choices.compiledPath !== undefined && choices.darklua !== true)
			throw new UsageError(
				"--compiled-path is for Darklua: pass --darklua with it."
			);
		return {
			routes: list(choices.routes, "--route"),
			unroutes: choices.unroutes,
			unmatched: choices.unmatched,
			sourcePaths: list(choices.sourcePaths, "--source-path"),
			unsourcePaths: choices.unsourcePaths,
			darklua: choices.darklua,
			compiledPath: choices.compiledPath,
			packages: list(choices.packages, "--package"),
		};
	}

	private routesOf(): Record<string, unknown> {
		const routes = this.edit.valueAt([ROGEN_BLOCK, "routes"]);
		return isObject(routes) ? routes : {};
	}

	/** The routes the config has, as the ids of the standard routes they are. */
	private configuredRoutes(): string[] {
		const starting = new StartingRoutes(this.language);
		const keys = Object.keys(this.routesOf());
		return starting.options
			.filter((option) =>
				keys.some(
					(key) =>
						DeclaredKeys.identityOf(key) ===
						DeclaredKeys.identityOf(option.key)
				)
			)
			.map(({ id }) => id);
	}

	/** Where unmatched files go, in the words of the menu: the shared route, else the target. */
	private fallbackLabel(routes: Record<string, unknown>): string {
		const target = routes[DeclaredKeys.FALLBACK_ROUTE];
		return target === new StartingRoutes(this.language).sharedTarget
			? "shared"
			: String(target);
	}

	private packagesToMount() {
		const mounted = mountedIn(this.edit.value.tree);
		return [
			...this.directory.workspace.packageMounts(this.language),
			...this.language.offeredMounts(),
		].filter(
			(mount) =>
				mount.installed &&
				!mounted.some((dir) => containsPosix(dir, mount.path))
		);
	}

	/** One row per area with what the project has. */
	describe(): [string, string][] {
		const routes = this.routesOf();
		const sourcePaths = this.changes().sourcePaths;
		const rows: [string, string][] = [
			[
				"Routes",
				label(
					Object.keys(routes).filter(
						(key) => key !== DeclaredKeys.FALLBACK_ROUTE
					),
					"none"
				),
			],
			[
				"Unmatched files",
				DeclaredKeys.FALLBACK_ROUTE in routes
					? this.fallbackLabel(routes)
					: "left out",
			],
			["Source paths", label(sourcePaths, "none")],
		];
		return rows;
	}

	/** The areas of the config that have something to change. */
	async areas(): Promise<ChangeArea[]> {
		return [
			...(this.routed
				? [
						{
							id: "routes",
							label: "Routes",
							hint: "add or take off a standard route",
						},
						{
							id: "unmatched",
							label: "Unmatched files",
							hint: "where files that match no route go",
						},
						{
							id: "sourcePaths",
							label: "Source paths",
							hint: "add or remove a folder",
						},
					]
				: []),
			...(this.routed && this.packagesToMount().length > 0
				? [
						{
							id: "packages",
							label: "Packages",
							hint: "mount the package folders found",
						},
					]
				: []),
		];
	}

	/** Asks what each picked area needs. */
	async ask(picked: readonly string[]): Promise<ChangeRequest | undefined> {
		const { questions } = this;
		const request: {
			-readonly [K in keyof ChangeRequest]: ChangeRequest[K];
		} = {};
		for (const id of picked) {
			switch (id) {
				case "routes": {
					const routes = await questions.changeRoutes(
						new StartingRoutes(this.language).options,
						this.configuredRoutes()
					);
					if (routes === undefined) return undefined;
					request.routes = routes.add;
					request.unroutes = routes.remove;
					break;
				}
				case "unmatched": {
					const routes = this.routesOf();
					const answer = await questions.changeUnmatched(
						DeclaredKeys.FALLBACK_ROUTE in routes
							? "shared"
							: "leave",
						new StartingRoutes(this.language).sharedTarget
					);
					if (answer === undefined) return undefined;
					request.unmatched = answer;
					break;
				}
				case "sourcePaths": {
					const current = this.changes().sourcePaths;
					const answer = await questions.changeSourcePaths(
						current,
						this.directory,
						(entry) =>
							new CodeFinder(this.fileSystemService).codeFilesIn(
								path.join(
									this.directory.path,
									normalizeDir(entry)
								)
							)
					);
					if (answer === undefined) return undefined;
					request.sourcePaths = answer.add;
					request.unsourcePaths = answer.remove;
					break;
				}
				case "packages": {
					const mounts = await questions.changePackages(
						this.packagesToMount()
					);
					if (mounts === undefined) return undefined;
					request.packages = mounts;
					break;
				}
			}
		}
		return request;
	}
}
