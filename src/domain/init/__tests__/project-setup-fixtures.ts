import path from "path";
import { ResultError } from "../../../base/result.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { RogenConfig } from "../../config/config.js";
import { InitQuestions } from "../init-questions.js";
import { ProjectChoices, ProjectSetup } from "../project-setup.js";
import { MockPromptService } from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import {
	WorkspaceSpec,
	directory,
	directoryOf,
	legacyPlan,
	placeFoldersOf,
	planOf,
} from "./init-fixtures.js";
import { TemplateChoice } from "../template-plan.js";

export const LUAU_ROUTES = {
	Server: "ServerScriptService",
	Client: "StarterPlayer/StarterPlayerScripts",
	Shared: "ReplicatedStorage/Shared",
	"*": "ReplicatedStorage/Shared",
};
export const ROBLOX_TS_ROUTES = {
	server: "ServerScriptService",
	client: "StarterPlayer/StarterPlayerScripts",
	shared: "ReplicatedStorage/shared",
	"*": "ReplicatedStorage/shared",
};

export const luau: WorkspaceSpec = {};
export const withPackages: WorkspaceSpec = {
	packageManager: "wally",
	packageDirs: new Set(["Packages"]),
};
export const mounts = {
	ReplicatedStorage: { Packages: { $path: "Packages" } },
	ServerScriptService: {
		ServerPackages: { $path: { optional: "ServerPackages" } },
	},
};

export const defaultProjectChoices = async (
	spec: WorkspaceSpec,
	name: string,
	existingFiles: ReadonlySet<string>,
	withPlaces: boolean
): Promise<ProjectChoices> => {
	const fileSystem = new MemoryFileSystemService();
	await fileSystem.createDirectory(directory);
	for (const file of existingFiles)
		await fileSystem.writeFile(path.join(directory, file), "{}");
	const setup = new ProjectSetup(
		directoryOf({
			workspace: spec,
			existing: [...existingFiles],
			givenName: name === "default" ? undefined : name,
		}),
		new InitQuestions(new MockPromptService([], false), false),
		fileSystem,
		placeFoldersOf(fileSystem)
	);
	const choices = (await setup.ask()).unwrap() as ProjectChoices;
	return withPlaces ? choices : { ...choices, places: [] };
};

export interface ProjectPlanOptions {
	readonly choices: Omit<ProjectChoices, "template"> & {
		readonly template: TemplateChoice;
	};
	readonly projectName: string;
	readonly directory: string;
	readonly existingFiles: ReadonlySet<string>;
	readonly copiedTemplate?: string;
}

export const planProject = ({
	choices,
	directory: dir,
	existingFiles,
	copiedTemplate,
}: ProjectPlanOptions) => {
	const target = directoryOf({ path: dir, existing: [...existingFiles] });
	return planOf(
		new ProjectSetup(
			target,
			new InitQuestions(new MockPromptService([], false), false),
			new MemoryFileSystemService(),
			placeFoldersOf()
		),
		{
			...choices,
			template:
				choices.template.kind === "copy"
					? { ...choices.template, content: copiedTemplate ?? "" }
					: choices.template,
		},
		target
	).map(legacyPlan);
};

export const planResult = async (
	workspace: WorkspaceSpec,
	name = "default",
	existingFiles: readonly string[] = []
) =>
	planProject({
		choices: await defaultProjectChoices(workspace, name, new Set(), false),
		projectName: "my-game",
		directory,
		existingFiles: new Set(existingFiles),
	});

export const plan = async (...args: Parameters<typeof planResult>) =>
	(await planResult(...args)).unwrap();

export const directoriesOf = async (
	spec: WorkspaceSpec,
	overrides: Partial<ProjectChoices> = {}
) => {
	const choices = {
		...(await defaultProjectChoices(spec, "default", new Set(), false)),
		...overrides,
	};
	const target = directoryOf({ path: directory, workspace: spec });
	return planOf(
		new ProjectSetup(
			target,
			new InitQuestions(new MockPromptService([], false), false),
			new MemoryFileSystemService(),
			placeFoldersOf()
		),
		choices,
		target
	).unwrap().directories;
};

export const errorsOf = (result: Awaited<ReturnType<typeof planResult>>) =>
	(result as ResultError<Diagnostic[]>).error;

export const treeOf = async (workspace: WorkspaceSpec) => {
	const { template } = await plan({ ...luau, ...workspace });
	return template && JSON.parse(template.content).tree;
};

export const configOf = (
	files: Awaited<ReturnType<typeof plan>>,
	fileName: string
): RogenConfig => {
	const file = files.configs.find((config) => config.fileName === fileName);
	if (!file) throw new Error(`${fileName} was not planned`);
	return JSON.parse(file.content);
};
