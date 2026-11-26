import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { EnvironmentService } from "../../../platform/environment/environment-service.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { instantiationOf } from "../../../platform/instantiation/__tests__/instantiation-of.js";
import { MockLifecycleService } from "../../../platform/lifecycle/__tests__/mock-lifecycle-service.js";
import { LifecycleService } from "../../../platform/lifecycle/lifecycle-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { ProcessService } from "../../../platform/process/process-service.js";
import {
	MockConfigService,
	selectionOf,
} from "../../config/__tests__/mock-config-service.js";
import { ConfigService } from "../../config/config-service.js";
import {
	abs,
	configOf,
	writeFiles,
	writeServiceOf,
} from "../../write/__tests__/fixtures.js";
import { WriteService } from "../../write/write-service.js";
import { AddedInstance } from "../added-instances.js";
import { Candidates, Planned } from "../candidates.js";
import { MirrorWorkspace } from "../mirror-workspace.js";
import { MirrorWorkspaceOpener } from "../mirror-workspace-opener.js";
import { RenamedInstance } from "../renamed-instances.js";
import { ROUTES } from "./layout-fixtures.js";

const NOTHING: Planned = { written: [], removed: [] };

describe("Candidates", () => {
	let fs: MemoryFileSystemService;

	const opened = async (
		files: readonly string[],
		spec: Parameters<typeof configOf>[0] = {}
	): Promise<MirrorWorkspace> => {
		await writeFiles(fs, ...files);
		const config = configOf({ routes: ROUTES, ...spec });
		const writeService = writeServiceOf(fs);
		await writeService.write(selectionOf(config));
		const services = instantiationOf(
			[ConfigService, new MockConfigService([])],
			[FileSystemService, fs],
			[WriteService, writeService],
			[EnvironmentService, new MockEnvironmentService("/repo")],
			[ProcessService, new MockProcessService()],
			[LifecycleService, new MockLifecycleService()]
		);
		return (
			await services.createInstance(MirrorWorkspaceOpener).open({
				selection: selectionOf(config),
				project: config,
				input: "game.rbxl",
				cwd: "/repo",
			})
		).unwrap();
	};

	const candidatesOf = (
		workspace: MirrorWorkspace,
		folders: readonly string[] = [],
		renames: readonly RenamedInstance[] = []
	) =>
		instantiationOf([FileSystemService, fs]).createInstance(
			Candidates,
			workspace,
			new Set(folders),
			renames
		);

	const mirrored = async (at: string, text = "return 1") =>
		fs.writeFile(abs(".rogen-syncback/mirror", at), text);

	const script = (
		parent: string[],
		name: string,
		file = `${name}.luau`
	): AddedInstance => ({
		parent,
		parentFolder: parent.join("/"),
		name,
		folder: false,
		files: [[file]],
	});

	beforeEach(() => {
		fs = new MemoryFileSystemService();
	});

	it("should propose a new script where routing puts it", async () => {
		const workspace = await opened(["src/Shop/Server/Main.luau"]);
		await mirrored("ServerScriptService/Shop/Cart.luau");

		const { candidates } = await candidatesOf(workspace).of(
			script(["ServerScriptService", "Shop"], "Cart"),
			NOTHING
		);

		expect(
			candidates.map(({ source, operations }) => ({
				source,
				files: operations.map(({ kind, file }) => `${kind} ${file}`),
			}))
		).toEqual([
			{
				source: "route",
				files: [`write ${abs("src/Shop/Server/Cart.luau")}`],
			},
			{
				source: "mark",
				files: [`write ${abs("src/Shop/Server/Cart@Server.luau")}`],
			},
		]);
	});

	const summary = (found: Awaited<ReturnType<Candidates["of"]>>) =>
		found.candidates.map(({ source, operations }) => ({
			source,
			files: operations.map(({ kind, file }) => `${kind} ${file}`),
		}));

	it("should propose where Rojo wrote an instance first", async () => {
		const workspace = await opened(["src/Shop/Server/Main.luau"]);
		await mirrored("ServerScriptService/Shop/Cart.luau");
		const made = script(["ServerScriptService", "Shop"], "Cart");
		const rojo = {
			operations: [
				{
					kind: "folder" as const,
					file: abs("src/Shop/Cart"),
					instance: "ServerScriptService/Shop/Cart",
				},
			],
			landings: [],
			folders: [],
		};

		const found = await candidatesOf(workspace).of(made, NOTHING, rojo);

		expect(summary(found).map(({ source }) => source)).toEqual([
			"rojo",
			"route",
			"mark",
		]);
		expect(found.candidates[0].operations).toBe(rojo.operations);
	});

	it("should propose a renamed feature's move before routing", async () => {
		const workspace = await opened(["src/Shop/Server/Main.luau"]);
		await mirrored("ServerScriptService/Store/Main.luau");
		const made: AddedInstance = {
			parent: ["ServerScriptService"],
			parentFolder: "ServerScriptService",
			name: "Store",
			folder: true,
			files: [["Store", "Main.luau"]],
		};
		const rename: RenamedInstance = {
			instance: made,
			from: "Shop",
			folder: abs("src/Shop"),
			renamed: abs("src/Store"),
			files: new Map([
				[
					"Store/Main.luau",
					{ target: abs("src/Store/Server/Main.luau") },
				],
			]),
			kept: [],
		};

		const found = await candidatesOf(workspace, [], [rename]).of(made, {
			written: [],
			removed: [abs("src/Shop/Server/Main.luau")],
		});

		expect(summary(found)[0]).toEqual({
			source: "rename",
			files: [
				`write ${abs("src/Store/Server/Main.luau")}`,
				`prune ${abs("src/Shop/Server")}`,
				`prune ${abs("src/Shop")}`,
			],
		});
		expect(summary(found)[1].source).toBe("route");
	});

	it("should not propose a rename whose new folder is already there", async () => {
		const workspace = await opened([
			"src/Shop/Server/Main.luau",
			"src/Store/Server/Other.luau",
		]);
		await mirrored("ServerScriptService/Store/Main.luau");
		const made: AddedInstance = {
			parent: ["ServerScriptService"],
			parentFolder: "ServerScriptService",
			name: "Store",
			folder: true,
			files: [["Store", "Main.luau"]],
		};

		const found = await candidatesOf(
			workspace,
			[],
			[
				{
					instance: made,
					from: "Shop",
					folder: abs("src/Shop"),
					renamed: abs("src/Store"),
					files: new Map([
						[
							"Store/Main.luau",
							{ target: abs("src/Store/Server/Main.luau") },
						],
					]),
					kept: [],
				},
			]
		).of(made, NOTHING);

		expect(summary(found).map(({ source }) => source)).not.toContain(
			"rename"
		);
	});

	it("should say a file is already there when routing's target exists", async () => {
		const workspace = await opened([
			"src/Shop/Server/Main.luau",
			"src/Shop/Server/Cart.luau",
		]);
		await mirrored("ServerScriptService/Shop/Cart.luau");

		const found = await candidatesOf(workspace).of(
			script(["ServerScriptService", "Shop"], "Cart"),
			NOTHING
		);

		expect(found).toEqual({
			candidates: [],
			reason: `${abs("src/Shop/Server/Cart.luau")} is already there`,
		});
	});

	it("should propose a file the plan removes as free", async () => {
		const workspace = await opened([
			"src/Shop/Server/Main.luau",
			"src/Shop/Server/Cart.luau",
		]);
		await mirrored("ServerScriptService/Shop/Cart.luau");

		const found = await candidatesOf(workspace).of(
			script(["ServerScriptService", "Shop"], "Cart"),
			{ written: [], removed: [abs("src/Shop/Server/Cart.luau")] }
		);

		expect(summary(found)[0].files).toEqual([
			`write ${abs("src/Shop/Server/Cart.luau")}`,
		]);
	});

	it("should say an ignore glob matches routing's target", async () => {
		const workspace = await opened(["src/Shop/Server/Main.luau"], {
			project: {
				tree: { $className: "DataModel" },
				globIgnorePaths: ["**/*.spec.luau"],
			},
		});
		await mirrored("ServerScriptService/Shop/Cart.spec.luau");

		const found = await candidatesOf(workspace).of(
			script(["ServerScriptService", "Shop"], "Cart.spec"),
			NOTHING
		);

		expect(found).toEqual({
			candidates: [],
			reason: `${abs("src/Shop/Server/Cart.spec.luau")} matches an ignore glob of the project, so it is left alone`,
		});
	});
});
