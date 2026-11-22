import { ResultError } from "../../../base/result.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
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

	it("should take a folder the project keeps empty at the instance it was written for", () => {
		expect(
			landingMiss({ file: posix("src/Quest"), instance: quest }, [
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
			landingMiss({ file: posix("src/Quest"), instance: quest }, [
				{ status: "empty", source: posix("src/Quest"), exists: true },
			])
		).toBe(`routing would make no instance of ${posix("src/Quest")}`);
	});

	it("should take a new folder at the instance a file inside it makes of it", () => {
		const folder = posix("src/Quest");

		expect(
			landingMiss({ file: folder, instance: quest, folder: true }, [
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
			landingMiss({ file: folder, instance: quest, folder: true }, [
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

	it("should say no instance comes from a new folder no file inside makes", () => {
		expect(
			landingMiss(
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
			[WriteService, writeServiceOf(fs, new CoreIndexService(fs))],
			[FileSystemService, fs]
		).createInstance(DraftRouting, request, known);

	const projectErrors = async () =>
		(
			(await writeServiceOf(fs, new CoreIndexService(fs)).locate(
				request.selection,
				{ args: [], cwd: request.cwd }
			)) as ResultError<DiagnosticsError>
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

		expect(misses.get(proposal)).toMatch(
			/^the write would stop on .*Types.* \(tree\.instanceClash: /
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
			`the write would stop on ${known[0].resource} (${known[0].code}: ${known[0].message.replace(/\.$/, "")})`
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
