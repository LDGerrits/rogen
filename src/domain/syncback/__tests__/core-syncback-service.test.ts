import path from "path";
import { Result, ResultError, ok } from "../../../base/result.js";
import { errorDiagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import {
	abs,
	buildServiceOf,
	configOf,
	writeFiles,
} from "../../build/__tests__/fixtures.js";
import { selectionOf } from "../../config/__tests__/mock-config-service.js";
import { ResolvedConfig } from "../../config/resolved-config.js";
import {
	RojoCommandRequest,
	RojoCommandRun,
	RojoCommandService,
} from "../../runner/rojo-command-service.js";
import { ServerMessage } from "../../runner/sync-server.js";
import { CoreSyncbackService } from "../core-syncback-service.js";
import { SyncbackRequest } from "../syncback.js";
import { ROUTES } from "./layout-fixtures.js";

/** A Rojo that records what it was asked and does what the test says it did. */
class FakeRojo implements RojoCommandService {
	declare readonly _serviceBrand: undefined;
	readonly requests: RojoCommandRequest[] = [];
	readonly projectTexts: string[] = [];
	say: (request: RojoCommandRequest) => Promise<string[] | Error> =
		async () => [];

	constructor(private readonly fs: MemoryFileSystemService) {}

	choose(): never {
		throw new Error("not used");
	}

	projects(): never {
		throw new Error("not used");
	}

	runBare(): never {
		throw new Error("not used");
	}

	async run(
		_selection: unknown,
		request: RojoCommandRequest
	): Promise<Result<RojoCommandRun, Error>> {
		this.requests.push(request);
		if (request.projectFile)
			this.projectTexts.push(await this.fs.readFile(request.projectFile));
		const said = await this.say(request);
		const project = request.project as ResolvedConfig;
		if (said instanceof Error)
			return ok({
				project,
				messages: [],
				failure: said as DiagnosticsError,
			});
		return ok({
			project,
			messages: said.map((text): ServerMessage => ({
				severity: "info",
				text,
			})),
		});
	}
}

describe("CoreSyncbackService", () => {
	let fs: MemoryFileSystemService;
	let rojo: FakeRojo;
	let service: CoreSyncbackService;
	let config: ResolvedConfig;
	let request: SyncbackRequest;

	const prepare = async (
		files: readonly string[],
		spec: Parameters<typeof configOf>[0] = {}
	) => {
		await writeFiles(fs, ...files);
		config = configOf({ routes: ROUTES, ...spec });
		const selection = selectionOf(config);
		await buildServiceOf(fs, new CoreIndexService(fs)).build(selection);
		request = {
			selection,
			project: config,
			input: "game.rbxl",
			cwd: "/repo",
		};
	};

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		rojo = new FakeRojo(fs);
		service = new CoreSyncbackService(
			fs,
			buildServiceOf(fs, new CoreIndexService(fs)),
			rojo
		);
	});

	it("should run Rojo's syncback on a project file of its own, with the user's input", async () => {
		await prepare(["src/Combat/Server/Combat.luau"]);

		await service.plan(request);

		const [run] = rojo.requests;
		expect(run).toMatchObject({
			command: "syncback",
			flags: [
				"--input",
				"game.rbxl",
				"--non-interactive",
				"--dry-run",
				"--list",
			],
			projectFile: abs("rogen-syncback.project.json"),
			since: "7.5.0",
		});
		expect(
			JSON.parse(rojo.projectTexts[0]).tree.ServerScriptService
		).toMatchObject({
			Combat: { $path: "src/Combat/Server" },
		});
	});

	it("should leave no file of its own behind, after a plan or a run", async () => {
		await prepare(["src/Combat/Server/Combat.luau"]);

		await service.plan(request);
		await service.apply(
			{ project: config, changes: [], unplaced: [] },
			request
		);

		expect(await fs.exists(abs("rogen-syncback.project.json"))).toBe(false);
		expect(await fs.exists(abs(".rogen-syncback"))).toBe(false);
	});

	it("should list what Rojo writes and removes in the folders of the project", async () => {
		await prepare(["src/Combat/Server/Combat.luau"]);
		rojo.say = async () => [
			"Writing src/Combat/Server/Combat.luau",
			"Removing src/Combat/Server/Hit.luau",
			"Writing to the file system...",
		];

		const plan = (await service.plan(request)).unwrap();

		expect(plan.changes).toEqual([
			{ kind: "write", file: abs("src/Combat/Server/Combat.luau") },
			{ kind: "remove", file: abs("src/Combat/Server/Hit.luau") },
		]);
	});

	it("should leave a folder out of the list when a file in it is listed", async () => {
		await prepare(["src/Combat/Server/Combat.luau"]);
		rojo.say = async () => [
			"Writing src/Combat/Server/Sub",
			"Writing src/Combat/Server/Sub/A.luau",
		];

		const plan = (await service.plan(request)).unwrap();

		expect(plan.changes.map(({ file }) => path.basename(file))).toEqual([
			"A.luau",
		]);
	});

	it("should place a new instance Rojo had no folder for beside its siblings", async () => {
		await prepare([
			"src/Inventory/Bag@server.luau",
			"src/Inventory/Save@server.luau",
		]);
		rojo.say = async () => [
			"Writing .rogen-syncback/new/0/Mail.luau",
			"Writing .rogen-syncback/new/0",
		];

		const plan = (await service.plan(request)).unwrap();

		expect(plan.changes).toEqual([
			{ kind: "write", file: abs("src/Inventory/Mail@server.luau") },
		]);
		expect(plan.unplaced).toEqual([]);
	});

	it("should say why an instance has no place, and not write it", async () => {
		await prepare([
			"src/Inventory/Server/Bag.luau",
			"src/Inventory/Save@server.luau",
		]);
		rojo.say = async () => ["Writing .rogen-syncback/new/0/Mail.luau"];

		const plan = (await service.plan(request)).unwrap();

		expect(plan.changes).toEqual([]);
		expect(plan.unplaced).toMatchObject([
			{
				instance: "ServerScriptService/Inventory/Mail",
				reason: expect.stringContaining("more than one place"),
			},
		]);
	});

	it("should move what Rojo wrote into staging to where routing puts it", async () => {
		await prepare(["src/Combat/Server/Combat.luau"]);
		rojo.say = async ({ flags }) => {
			if (flags.includes("--dry-run")) return [];
			await fs.writeFile(
				abs(".rogen-syncback/new/0/Quest/Main.luau"),
				"return 1"
			);
			return ["Writing .rogen-syncback/new/0/Quest/Main.luau"];
		};

		const result = (
			await service.apply(
				{ project: config, changes: [], unplaced: [] },
				request
			)
		).unwrap();

		expect(await fs.readFile(abs("src/Quest/Server/Main.luau"))).toBe(
			"return 1"
		);
		expect(result.changes).toEqual([
			{ kind: "write", file: abs("src/Quest/Server/Main.luau") },
		]);
		expect(result.warnings).toEqual([]);
	});

	it("should not overwrite a file that is already where a new instance would go", async () => {
		await prepare([
			"src/Inventory/Bag@server.luau",
			"src/Inventory/Save@server.luau",
			"src/Inventory/Mail@server.meta.json",
		]);
		rojo.say = async () => [
			"Writing .rogen-syncback/new/0/Mail.luau",
			"Writing .rogen-syncback/new/0/Mail.meta.json",
		];

		const plan = (await service.plan(request)).unwrap();

		expect(plan.changes).toEqual([]);
		expect(plan.unplaced[0].reason).toContain("already there");
	});

	it("should name the file to delete when Rojo refuses to remove an instance a project file defines", async () => {
		await prepare([
			"src/Inventory/Bag@server.luau",
			"src/Inventory/Save@server.luau",
		]);
		rojo.say = async () =>
			new DiagnosticsError([
				errorDiagnostic(
					"rojo.commandFailed",
					{ resource: abs("rogen-syncback.project.json") },
					"'rojo syncback' failed (exit code 1): Failed to syncback because The child 'Bag' of Instance 'Inventory' is present only in a project file, and not the provided file."
				),
			]);

		const planned = await service.plan(request);

		expect(planned.isErr()).toBe(true);
		const error = (planned as ResultError<DiagnosticsError>).error;
		expect(error.diagnostics).toMatchObject([
			{
				code: "syncback.removedFromProjectFile",
				message: expect.stringContaining(
					path
						.join("src", "Inventory", "Bag@server.luau")
						.replaceAll("\\", "/")
						.split("/")
						.join(path.sep)
				),
			},
		]);
	});

	it("should hand Rojo a project file it did not write as it is", async () => {
		await writeFiles(fs, "src/A.luau");
		await fs.writeFile(abs("default.project.json"), "{}");
		config = configOf({ file: abs("default.project.json") });
		request = {
			selection: selectionOf(config),
			project: config,
			input: "game.rbxl",
			cwd: "/repo",
		};

		await service.plan(request);

		expect(rojo.requests[0].projectFile).toBe(abs("default.project.json"));
		expect(await fs.exists(abs("rogen-syncback.project.json"))).toBe(false);
	});

	it("should fail with Rojo's error when it fails for another reason", async () => {
		await prepare(["src/Combat/Server/Combat.luau"]);
		const failure = new DiagnosticsError([
			errorDiagnostic(
				"rojo.commandFailed",
				{ resource: abs("x") },
				"no such file"
			),
		]);
		rojo.say = async () => failure;

		expect(((await service.plan(request)) as { error: Error }).error).toBe(
			failure
		);
	});

	it("should say when the project file has not been written", async () => {
		await writeFiles(fs, "src/A.luau");
		config = configOf({ routes: ROUTES });
		request = {
			selection: selectionOf(config),
			project: config,
			input: "x",
			cwd: "/repo",
		};

		const planned = await service.plan(request);

		expect(planned.isErr()).toBe(true);
	});
});
