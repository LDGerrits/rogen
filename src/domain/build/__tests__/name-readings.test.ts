import { DisposableStore } from "../../../base/disposable.js";
import { toPosix } from "../../../base/path.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfigSpec } from "../../config/__tests__/mock-config-service.js";
import {
	abs,
	configOf,
	indexOf,
	placeFiles,
	syncTools,
	writeFiles,
} from "./fixtures.js";

describe("NameReadings", () => {
	const at = (...segments: string[]) => toPosix(abs(...segments));

	describe("reading", () => {
		let fs: MemoryFileSystemService;
		let store: DisposableStore;

		const write = (...paths: string[]) => writeFiles(fs, ...paths);

		const read = async (overrides: ResolvedConfigSpec = {}) => {
			const config = configOf({
				routes: {
					server: "ServerScriptService",
					"*": "ReplicatedStorage",
				},
				variants: { mock: true },
				...overrides,
			});
			const index = await indexOf(store, fs, config.rootDirs);
			return placeFiles(index, config, syncTools).unwrap().readings;
		};

		beforeEach(() => {
			fs = new MemoryFileSystemService();
			store = new DisposableStore();
		});

		afterEach(() => {
			store[Symbol.dispose]();
		});

		describe("folders", () => {
			it("should classify each folder above an entry, outermost first", async () => {
				await write("src/server/(Hidden)/mock/Inventory/Save.luau");

				const { entries } = await read();
				const entry = entries.get(
					at("src/server/(Hidden)/mock/Inventory/Save.luau")
				);

				expect(
					entry?.folders.map(
						({
							segment,
							route,
							variants,
							keptName,
							invisible,
							dir,
						}) => ({
							segment,
							route,
							variants,
							keptName,
							invisible,
							dir,
						})
					)
				).toEqual([
					{
						segment: "server",
						route: "server",
						variants: [],
						keptName: undefined,
						invisible: false,
						dir: "server",
					},
					{
						segment: "(Hidden)",
						route: undefined,
						variants: [],
						keptName: "Hidden",
						invisible: true,
						dir: "server/(Hidden)",
					},
					{
						segment: "mock",
						route: undefined,
						variants: ["mock"],
						keptName: undefined,
						invisible: false,
						dir: "server/(Hidden)/mock",
					},
					{
						segment: "Inventory",
						route: undefined,
						variants: [],
						keptName: "Inventory",
						invisible: false,
						dir: "server/(Hidden)/mock/Inventory",
					},
				]);
			});

			it("should read a folder shared by many entries once", async () => {
				await write("src/Inventory/A.luau", "src/Inventory/B.luau");

				const { entries } = await read();

				expect(
					entries.get(at("src/Inventory/A.luau"))?.folders[0]
				).toBe(entries.get(at("src/Inventory/B.luau"))?.folders[0]);
			});

			it("should read a folder that only holds meta", async () => {
				await write("src/Empty/init.meta.json");

				const { folders } = await read();

				expect(folders.get(at("src/Empty"))).toMatchObject({
					keptName: "Empty",
					variants: [],
					segment: "Empty",
				});
			});

			it("should note a plain folder that only differs from a key in case", async () => {
				await write("src/SERVER/Save.luau", "src/Inventory/Save.luau");

				const { folders } = await read();

				expect(folders.get(at("src/SERVER"))?.nearMissKey).toBe(
					"server"
				);
				expect(
					folders.get(at("src/Inventory"))?.nearMissKey
				).toBeUndefined();
			});
		});

		describe("markers", () => {
			it("should read the key a marker declares", async () => {
				await write("src/@server", "src/.mock", "src/.other");

				const { markers } = await read();

				expect(markers.get(at("src/@server"))?.key).toBe("server");
				expect(markers.get(at("src/.mock"))?.key).toBe("mock");
				expect(markers.get(at("src/.other"))?.key).toBeUndefined();
			});

			it("should note a marker that only differs from a key in case", async () => {
				await write("src/@SERVER", "src/Save.luau");

				const { markers } = await read();

				expect(markers.get(at("src/@SERVER"))).toMatchObject({
					key: undefined,
					nearMissKey: "server",
				});
			});
		});

		describe("entries", () => {
			it("should read the suffixes of a file's stem", async () => {
				await write("src/Save.mock.server.luau");

				const { entries } = await read();
				const entry = entries.get(at("src/Save.mock.server.luau"));

				expect(entry).toMatchObject({
					fileName: "Save.mock.server.luau",
					kind: "script",
				});
				expect(entry?.match.spans.map(({ key }) => key)).toEqual([
					"server",
					"mock",
				]);
			});

			it("should read an init script like any other file", async () => {
				await write("src/Inventory/init.server.luau");

				const { entries } = await read();
				const entry = entries.get(at("src/Inventory/init.server.luau"));

				expect(entry).toMatchObject({
					fileName: "init.server.luau",
					kind: "script",
					scriptSuffix: "server",
				});
				expect(entry?.match.matchedKeys).toEqual(new Set(["server"]));
			});

			it("should note an @ that matches no route, with the closest one", async () => {
				await write("src/Save@sever.luau");

				const { entries } = await read();

				expect(
					entries.get(at("src/Save@sever.luau"))?.match.strayAt
				).toMatchObject({ text: "sever", suggestion: "@server" });
			});

			it("should read a data file without its .json suffix", async () => {
				await write("src/Config.server.json");

				const { entries } = await read();
				const entry = entries.get(at("src/Config.server.json"));

				expect(entry?.kind).toBe("data");
				expect(entry?.match.matchedKeys).toEqual(new Set(["server"]));
			});
		});
	});
});
