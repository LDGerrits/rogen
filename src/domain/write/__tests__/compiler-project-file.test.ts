import { jest } from "@jest/globals";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { selectionOf } from "../../config/__tests__/mock-config-service.js";
import { ResolvedConfig } from "../../config/resolved-config.js";
import { RojoProjectFile } from "../../rojo/rojo-project.js";
import { abs, configOf, writeServiceOf } from "./fixtures.js";

const PLACE = abs("projects/game/default.rogen.json");
const COMPILER = "projects/game/compiler.project.json";

describe("the compiler's project file", () => {
	let fs: MemoryFileSystemService;

	const placeOf = (
		overrides: Parameters<typeof configOf>[0] = {}
	): ResolvedConfig =>
		configOf({
			file: PLACE,
			sourcePaths: [abs("projects/common/src"), abs("projects/game/src")],
			compiledPath: abs("out/game"),
			routes: { "*": "ReplicatedStorage" },
			project: {
				name: "game",
				tree: {
					$className: "DataModel",
					Workspace: { $path: "map/Workspace" },
					ServerStorage: {
						$className: "ServerStorage",
						Model: { $path: "map/Model.rbxm" },
						Nested: { $path: "map/Nested.project.json" },
						Maybe: { $path: { optional: "map/Maybe" } },
						Base: {
							$className: "Part",
							$path: "map/Base.rbxm",
							$properties: { Anchored: true },
						},
						Packages: { $path: "../../Packages" },
					},
				},
			},
			...overrides,
		});

	const service = () => writeServiceOf(fs, new CoreIndexService(fs));

	const write = (config: ResolvedConfig) =>
		service().write(selectionOf(config));

	const readJson = async (file: string) =>
		JSON.parse(await fs.readFile(abs(file))) as RojoProjectFile;

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.writeFile(abs("projects/common/src/Shared.luau"), "");
		await fs.writeFile(abs("projects/game/src/Main.luau"), "");
	});

	it("should drop the mounts inside the common root and keep the rest", async () => {
		await write(placeOf());

		const { tree } = await readJson(COMPILER);

		expect(tree).toMatchObject({
			Workspace: {},
			ServerStorage: {
				$className: "ServerStorage",
				Model: { $className: "Folder" },
				Nested: { $className: "Folder" },
				Maybe: { $className: "Folder" },
				Base: { $className: "Part", $properties: { Anchored: true } },
				Packages: { $path: "../../Packages" },
			},
		});
	});

	it("should keep the mounts of compiled output", async () => {
		await write(placeOf());

		const { tree } = await readJson(COMPILER);

		expect(JSON.stringify(tree)).toContain('"optional":"../../out/game');
	});

	it("should still write the full project file with the mounts", async () => {
		await write(placeOf());

		expect(
			await fs.readFile(abs("projects/game/default.project.json"))
		).toContain('"$path": "map/Workspace"');
	});

	it("should name it after a named config", async () => {
		await write(placeOf({ file: abs("projects/game/dist.rogen.json") }));

		expect(
			await fs.exists(abs("projects/game/dist.compiler.project.json"))
		).toBe(true);
		expect(await fs.exists(abs(COMPILER))).toBe(false);
	});

	it("should write none for one place, whose common root is its source folder", async () => {
		await write(placeOf({ sourcePaths: [abs("projects/game/src")] }));

		expect(await fs.exists(abs(COMPILER))).toBe(false);
	});

	it("should write none without a compiled path", async () => {
		await write(placeOf({ compiledPath: undefined }));

		expect(await fs.exists(abs(COMPILER))).toBe(false);
	});

	it("should say unchanged when both files are up to date, and wrote when only it changed", async () => {
		await write(placeOf());
		const [again] = (await write(placeOf())).outcomes;
		await fs.writeFile(abs(COMPILER), "{}");
		const [repaired] = (await write(placeOf())).outcomes;

		expect(again.kind).toBe("unchanged");
		expect(repaired.kind).toBe("wrote");
		expect((await readJson(COMPILER)).tree).toBeDefined();
	});

	it("should report a compiler file that cannot be written as the config's error", async () => {
		const writeFile = fs.writeFile.bind(fs);
		jest.spyOn(fs, "writeFile").mockImplementation(
			async (file, content) => {
				if (file.includes("compiler.project.json"))
					throw new Error("disk full");
				return writeFile(file, content);
			}
		);

		const [outcome] = (await write(placeOf())).outcomes;

		expect(outcome.kind).toBe("failed");
	});

	describe("on check", () => {
		it("should warn when it differs from what a write would write", async () => {
			await write(placeOf());
			await fs.writeFile(abs(COMPILER), "{}");

			const { outcomes } = await service().check(selectionOf(placeOf()));

			expect(outcomes[0].warnings).toMatchObject([
				{ code: "output.differs", resource: abs(COMPILER) },
			]);
		});

		it("should say nothing when it is up to date", async () => {
			await write(placeOf());

			const { outcomes } = await service().check(selectionOf(placeOf()));

			expect(outcomes[0].warnings).toEqual([]);
		});
	});
});
