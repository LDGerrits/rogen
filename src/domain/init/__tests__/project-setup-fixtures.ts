import path from "path";
import { ResultError } from "../../../base/result.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockPromptService } from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { workspaceOf } from "../../toolchain/__tests__/workspaces.js";
import { RogenConfig } from "../../config/config.js";
import { InitDirectory } from "../init-directory.js";
import { InitChoices, InitPlan } from "../init-service.js";
import { ProjectSetup } from "../project-setup.js";
import { SetupProject } from "../project-code.js";
import { WorkspaceSpec, directory, planOf } from "./init-fixtures.js";
import { codeFinderOf, questionsOf, setupOf } from "./init-of.js";

export const LUAU_ROUTES = {
	server: "ServerScriptService",
	client: "StarterPlayer/StarterPlayerScripts",
	shared: "ReplicatedStorage/Shared",
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
};

export const PROJECT_FILE = "default.project.json";

export interface ProjectSpec {
	readonly workspace?: WorkspaceSpec;
	readonly files?: Readonly<Record<string, string | object>>;
	readonly choices?: InitChoices;
	readonly tracksProjectFile?: boolean;
	readonly interactive?: boolean;
}

export const lifting = (
	project: string | object,
	spec: ProjectSpec = {}
): ProjectSpec => ({
	...spec,
	files: { ...spec.files, [PROJECT_FILE]: project },
});

const setupIn = async ({
	workspace,
	files = {},
	choices = { sample: false },
	tracksProjectFile = false,
	interactive = false,
}: ProjectSpec): Promise<{ setup: ProjectSetup; target: InitDirectory }> => {
	const fileSystem = new MemoryFileSystemService();
	await fileSystem.createDirectory(directory);
	for (const [file, content] of Object.entries(files))
		await fileSystem.writeFile(
			path.join(directory, file),
			typeof content === "string" ? content : JSON.stringify(content)
		);
	const detected = workspaceOf(workspace);
	const target = new InitDirectory(
		directory,
		new Set(
			(await fileSystem.readDirectory(directory)).map(([name]) => name)
		),
		detected,
		await codeFinderOf(fileSystem).layoutOf(directory, detected),
		tracksProjectFile
	);
	const setup = setupOf(
		target,
		questionsOf(
			new MockPromptService({}, interactive),
			interactive,
			choices
		),
		fileSystem
	);
	return { setup, target };
};

export const askProject = async (
	spec: ProjectSpec = {}
): Promise<SetupProject> => {
	const { setup } = await setupIn(spec);
	return (await setup.ask()).unwrap()!;
};

export const planResult = async (spec: ProjectSpec = {}) => {
	const { setup, target } = await setupIn(spec);
	return planOf(setup, (await setup.ask()).unwrap()!, target);
};

export const plan = async (spec: ProjectSpec = {}) =>
	(await planResult(spec)).unwrap();

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
	JSON.parse(
		(await plan({ workspace: { ...luau, ...workspace } })).files.find(
			({ fileName }) => fileName === "default.rogen.json"
		)!.content
	).tree;
