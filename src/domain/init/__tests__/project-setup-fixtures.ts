import path from "path";
import { ResultError } from "../../../base/result.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { RogenConfig } from "../../config/config.js";
import { InitPlan } from "../init-service.js";
import { InitQuestions } from "../init-questions.js";
import { ProjectChoices, ProjectSetup } from "../project-setup.js";
import { StarterProject } from "../starter-project.js";
import { ProjectTree } from "../tree-plan.js";
import { MockPromptService } from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import {
	WorkspaceSpec,
	directory,
	directoryOf,
	planOf,
} from "./init-fixtures.js";

export const LUAU_ROUTES = {
	Server: "ServerScriptService",
	Client: "StarterPlayer/StarterPlayerScripts",
	Shared: "ReplicatedStorage/Shared",
};
export const ROBLOX_TS_ROUTES = {
	server: "ServerScriptService",
	client: "StarterPlayer/StarterPlayerScripts",
	shared: "ReplicatedStorage/shared",
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
	existingFiles: ReadonlySet<string> = new Set()
): Promise<ProjectChoices> => {
	const fileSystem = new MemoryFileSystemService();
	await fileSystem.createDirectory(directory);
	for (const file of existingFiles)
		await fileSystem.writeFile(path.join(directory, file), "{}");
	const setup = new ProjectSetup(
		directoryOf({ workspace: spec, existing: [...existingFiles] }),
		new InitQuestions(new MockPromptService([], false), false, {
			sample: false,
		}),
		fileSystem
	);
	return (await setup.ask()).unwrap() as ProjectChoices;
};

export const lifted = (content: string | object): ProjectTree => ({
	kind: "lift",
	from: "default.project.json",
	project: StarterProject.parse(
		typeof content === "string" ? content : JSON.stringify(content)
	).unwrap(),
});

export interface ProjectPlanOptions {
	readonly choices: ProjectChoices;
	readonly existingFiles?: ReadonlySet<string>;
	readonly workspace?: WorkspaceSpec;
}

export const planProject = ({
	choices,
	existingFiles = new Set(),
	workspace,
}: ProjectPlanOptions) => {
	const target = directoryOf({ existing: [...existingFiles], workspace });
	return planOf(
		new ProjectSetup(
			target,
			new InitQuestions(new MockPromptService([], false), false, {
				sample: false,
			}),
			new MemoryFileSystemService()
		),
		choices,
		target
	);
};

export const planResult = async (
	workspace: WorkspaceSpec,
	existingFiles: readonly string[] = []
) =>
	planProject({
		choices: await defaultProjectChoices(workspace),
		existingFiles: new Set(existingFiles),
		workspace,
	});

export const plan = async (...args: Parameters<typeof planResult>) =>
	(await planResult(...args)).unwrap();

export const errorsOf = (result: Awaited<ReturnType<typeof planResult>>) =>
	(result as ResultError<Diagnostic[]>).error;

export const configOf = (planned: InitPlan): RogenConfig => {
	const file = planned.files.find(
		({ fileName }) => fileName === "default.rogen.json"
	);
	if (!file) throw new Error("default.rogen.json was not planned");
	return JSON.parse(file.content);
};

export const treeOf = async (workspace: WorkspaceSpec) =>
	JSON.parse((await plan({ ...luau, ...workspace })).files[0].content).tree;
