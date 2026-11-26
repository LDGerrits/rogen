import path from "path";
import { exampleMessage } from "../../../__tests__/diagnostic-examples.js";
import { ResultError } from "../../../base/result.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { instantiationOf } from "../../../platform/instantiation/__tests__/instantiation-of.js";
import { selectionOf } from "../../config/__tests__/mock-config-service.js";
import {
	configOf,
	writeFiles,
	writeServiceOf,
} from "../../write/__tests__/fixtures.js";
import {
	FileLocation,
	PlacedLocation,
	WriteService,
} from "../../write/write-service.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { DraftRouting, Proposal, landingMiss } from "../draft-routing.js";
import { SyncRules } from "../../rojo/sync-rules.js";
import { SyncbackRequest } from "../syncback.js";
import { ROUTES, abs } from "./layout-fixtures.js";

const posix = (...segments: string[]) => abs(...segments).replaceAll("\\", "/");

const placed = (
	source: string,
	instancePath: string[],
	folderNodes?: PlacedLocation["folderNodes"]
): FileLocation => ({
	status: "placed",
	source,
	exists: true,
	instancePath,
	route: "Server",
	routeMatch: "folder",
	...(folderNodes && { folderNodes }),
});

describe("landingMiss", () => {
	const quest = ["ServerScriptService", "Quest"];
	const missOf = (
		landing: Parameters<typeof landingMiss>[0],
		files: readonly FileLocation[],
		rules = SyncRules.DEFAULT
	) => landingMiss(landing, files, rules);

	it("should take a folder the project keeps empty at the instance it was written for", () => {
		expect(
			missOf({ file: posix("src/Quest"), instance: quest }, [
				{
					status: "empty",
					source: posix("src/Quest"),
					exists: true,
					instancePath: quest,
				},
			])
		).toBeUndefined();
	});

	it("should say no instance comes from an empty folder routing places nowhere", () => {
		expect(
			missOf({ file: posix("src/Quest"), instance: quest }, [
				{ status: "empty", source: posix("src/Quest"), exists: true },
			])
		).toBe(`routing would make no instance of ${posix("src/Quest")}`);
	});

	it("should take a new folder at the instance a file inside it makes of it", () => {
		const folder = posix("src/Quest");

		expect(
			missOf({ file: folder, instance: quest, folder: true }, [
				placed(posix("src/Other/Server/A.luau"), ["X"]),
				placed(posix("src/Quest/Server/Start.luau"), [
					...quest,
					"Start",
				]),
				placed(
					posix("src/Quest/Server/Log.luau"),
					[...quest, "Log"],
					[
						{
							folder: posix("src/Quest/Server"),
							instancePath: ["Y"],
						},
						{ folder, instancePath: quest },
					]
				),
			])
		).toBeUndefined();
	});

	it("should name the instance a new folder becomes when it is not the one it was written for", () => {
		const folder = posix("src/Quest");

		expect(
			missOf({ file: folder, instance: quest, folder: true }, [
				placed(
					posix("src/Quest/Shared/Log.luau"),
					["ReplicatedStorage", "Shared", "Quest", "Log"],
					[
						{
							folder,
							instancePath: [
								"ReplicatedStorage",
								"Shared",
								"Quest",
							],
						},
					]
				),
			])
		).toBe(
			`routing would read ${folder} as ReplicatedStorage/Shared/Quest; rename it in Studio`
		);
	});

	it("should blame the script type, not the name, for a script file routing reads as another instance", () => {
		const file = posix("src/Quest/Boot.server.luau");

		expect(
			missOf({ file, instance: quest }, [
				placed(file, ["ServerScriptService", "Quest", "Boot"]),
			])
		).toBe(
			`routing would read ${file} as ServerScriptService/Quest/Boot; make it a ModuleScript, or move it to where that type runs`
		);
	});

	it("should blame the script type of a plugin script routing reads as another instance", () => {
		const file = posix("src/Quest/Tool.plugin.luau");

		expect(
			missOf({ file, instance: quest }, [
				placed(file, ["ServerScriptService", "Quest", "Tool"]),
			])
		).toBe(
			`routing would read ${file} as ServerScriptService/Quest/Tool; make it a ModuleScript, or move it to where that type runs`
		);
	});

	it("should blame the script type of a script a sync rule reads", () => {
		const file = posix("src/Quest/Boot.server.lang");
		const rules = SyncRules.following(
			[
				{
					use: "serverScript",
					pattern: "*.server.lang",
					suffix: ".server.lang",
				},
			],
			posix("")
		);

		expect(
			missOf(
				{ file, instance: quest },
				[placed(file, ["ServerScriptService", "Quest", "Boot"])],
				rules
			)
		).toBe(
			`routing would read ${file} as ServerScriptService/Quest/Boot; make it a ModuleScript, or move it to where that type runs`
		);
	});

	it("should ask for a rename of a module a sync rule reads", () => {
		const file = posix("src/Quest/Boot.lang");
		const rules = SyncRules.following(
			[{ use: "moduleScript", pattern: "*.lang", suffix: ".lang" }],
			posix("")
		);

		expect(
			missOf(
				{ file, instance: quest },
				[placed(file, ["ServerScriptService", "Quest", "Boot"])],
				rules
			)
		).toBe(
			`routing would read ${file} as ServerScriptService/Quest/Boot; rename it in Studio`
		);
	});

	describe("a new folder that holds only an empty folder", () => {
		const bag = posix("src/Quest/Bag");
		const inside = (instance: string[]): FileLocation[] => [
			{
				status: "empty",
				source: `${bag}/Inner`,
				exists: true,
				instancePath: instance,
			},
			{ status: "empty", source: bag, exists: true },
		];

		it("should take it at the instance its empty folder implies", () => {
			expect(
				missOf(
					{ file: bag, instance: [...quest, "Bag"], folder: true },
					inside([...quest, "Bag", "Inner"])
				)
			).toBeUndefined();
		});

		it("should name the instance its empty folder implies when it is another", () => {
			expect(
				missOf(
					{ file: bag, instance: [...quest, "Bag"], folder: true },
					inside(["ReplicatedStorage", "Bag", "Inner"])
				)
			).toBe(
				`routing would read ${bag} as ReplicatedStorage/Bag; rename it in Studio`
			);
		});
	});

	it("should say no instance comes from a new folder no file inside makes", () => {
		expect(
			missOf(
				{ file: posix("src/Quest"), instance: quest, folder: true },
				[]
			)
		).toBe(`routing would make no instance of ${posix("src/Quest")}`);
	});
});

describe("DraftRouting", () => {
	let fs: MemoryFileSystemService;
	let request: SyncbackRequest;

	const write = (file: string, text = "return 1") => ({
		kind: "write" as const,
		file,
		instance: file,
		bytes: new TextEncoder().encode(text),
	});

	const routingOf = (known: readonly Diagnostic[] = []) =>
		instantiationOf(
			[WriteService, writeServiceOf(fs)],
			[FileSystemService, fs]
		).createInstance(DraftRouting, request, known);

	const projectErrors = async () =>
		(
			(await writeServiceOf(fs).locate(request.selection, {
				args: [],
				cwd: request.cwd,
			})) as ResultError<DiagnosticsError>
		).error.diagnostics;

	const mountSourcePath = () => {
		const config = configOf({
			routes: ROUTES,
			project: {
				tree: { $className: "DataModel", Workspace: { $path: "src" } },
			},
		});
		request = {
			...request,
			selection: selectionOf(config),
			project: config,
		};
	};

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		const config = configOf({ routes: ROUTES });
		request = {
			selection: selectionOf(config),
			project: config,
			input: "game.rbxl",
			cwd: abs(),
		};
	});

	it("should say what stops the write when a new file clashes with one beside it", async () => {
		await writeFiles(fs, "src/Inventory/Server/Types.lua");
		const file = abs("src/Inventory/Server/Types.luau");
		const proposal: Proposal = {
			operations: [write(file)],
			landings: [
				{
					file,
					instance: ["ServerScriptService", "Inventory", "Types"],
				},
			],
		};

		const misses = await routingOf().misses([], [proposal]);

		expect(
			`${misses.get(proposal)}`
				.replaceAll(`${abs()}${path.sep}`, "")
				.replaceAll(path.sep, "/")
		).toBe(
			exampleMessage("syncback.unplaced", "would stop on")
				.replace(
					"ServerScriptService/Inventory/Types was left out: ",
					""
				)
				.replace(/\.$/, "")
		);
	});

	it("should say what stops the write when an error it already knew blocks where a file lands", async () => {
		await writeFiles(fs, "src/Inventory/Server/Bag.luau");
		mountSourcePath();
		const known = await projectErrors();
		const file = abs("src/Inventory/Server/Pouch.luau");
		const proposal: Proposal = {
			operations: [write(file)],
			landings: [
				{
					file,
					instance: ["ServerScriptService", "Inventory", "Pouch"],
				},
			],
		};

		const misses = await routingOf(known).misses([], [proposal]);

		expect(known).not.toEqual([]);
		expect(misses.get(proposal)).toBe(
			`the write would stop on ${known[0].resource} (${known[0].code}); see \`rogen help ${known[0].code}\``
		);
	});

	it("should say what stops the write when a new folder it makes is a route in the wrong case", async () => {
		await writeFiles(fs, "src/Net/init.luau", "src/Net/A.luau");
		const file = abs("src/Net/server/Impl.luau");
		const proposal: Proposal = {
			operations: [write(file)],
			landings: [
				{
					file,
					instance: [
						"ReplicatedStorage",
						"Shared",
						"Net",
						"server",
						"Impl",
					],
				},
			],
		};

		const misses = await routingOf().misses([], [proposal]);

		expect(misses.get(proposal)).toMatch(
			/^the write would stop on .*server \(route\.caseMismatch\); rename it in Studio$/
		);
	});

	it("should miss every proposal when the project would fail to load", async () => {
		mountSourcePath();
		const proposal: Proposal = {
			operations: [
				{ kind: "folder", file: abs("src/Quest"), instance: "Quest" },
			],
			landings: [],
		};

		const misses = await routingOf().misses([], [proposal]);

		expect(misses.get(proposal)).toBe("the project would fail to load");
	});
});
