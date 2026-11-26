import { jest } from "@jest/globals";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { IndexService } from "../../../platform/fs/index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { EnvironmentService } from "../../../platform/environment/environment-service.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { SyncDescriptor } from "../../../platform/instantiation/sync-descriptor.js";
import { instantiationOf } from "../../../platform/instantiation/__tests__/instantiation-of.js";
import { CoreInstantiationService } from "../../../platform/instantiation/core-instantiation-service.js";
import { ConfigChecks } from "../../config/config-checks.js";
import { ConfigService } from "../../config/config-service.js";
import { CoreConfigService } from "../../config/core-config-service.js";
import { errorDiagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { ToolchainService } from "../../toolchain/toolchain-service.js";
import { toolchainOf } from "../../toolchain/__tests__/toolchain-of.js";
import { CoreWriteService } from "../core-write-service.js";
import { WriteService } from "../write-service.js";
import { abs, absPosix } from "./fixtures.js";

const CONFIG = JSON.stringify({
	sourcePaths: ["src"],
	routes: { "*": "ReplicatedStorage" },
});

describe("WriteService.openDraft", () => {
	let fs: MemoryFileSystemService;
	let checks: ConfigChecks;
	let root: ReturnType<typeof instantiationOf>;

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory(abs(".git"));
		await fs.writeFile(abs("src/A.luau"), "");
		checks = new ConfigChecks();
		root = instantiationOf(
			[FileSystemService, fs],
			[EnvironmentService, new MockEnvironmentService(abs())],
			[ToolchainService, toolchainOf(fs)],
			[IndexService, new SyncDescriptor(CoreIndexService)],
			[ConfigService, new SyncDescriptor(CoreConfigService, [checks])],
			[WriteService, new SyncDescriptor(CoreWriteService)]
		);
	});

	afterEach(() => root[Symbol.dispose]());

	const rootWriteService = () =>
		root.invokeFunction((accessor) => accessor.get(WriteService));

	const openDraft = () =>
		rootWriteService().openDraft({
			files: new Map([
				[abs("default.rogen.json"), CONFIG],
				[abs("src/B.luau"), ""],
			]),
			directories: [],
			moves: [],
		});

	it("should select a config that exists only in the draft", async () => {
		const draft = openDraft();
		try {
			const selection = await draft.configService.select([
				abs("default.rogen.json"),
			]);

			expect(selection.unwrap().configs).toHaveLength(1);
		} finally {
			draft[Symbol.dispose]();
		}
	});

	it("should list and place a file that exists only in the draft", async () => {
		const draft = openDraft();
		try {
			const selection = (
				await draft.configService.select([abs("default.rogen.json")])
			).unwrap();

			const located = (
				await draft.writeService.locate(selection)
			).unwrap();

			expect(
				located.configs[0].files
					.filter(({ status }) => status === "placed")
					.map(({ source }) => source)
			).toEqual([absPosix("src/A.luau"), absPosix("src/B.luau")]);
		} finally {
			draft[Symbol.dispose]();
		}
	});

	it("should check the draft without writing to the disk", async () => {
		const draft = openDraft();
		try {
			const selection = (
				await draft.configService.select([abs("default.rogen.json")])
			).unwrap();

			const checked = await draft.writeService.check(selection);

			expect(checked.failure()).toBeUndefined();
			expect(await fs.exists(abs("default.rogen.json"))).toBe(false);
		} finally {
			draft[Symbol.dispose]();
		}
	});

	it("should refuse to write the draft's project file", async () => {
		const draft = openDraft();
		try {
			const selection = (
				await draft.configService.select([abs("default.rogen.json")])
			).unwrap();

			const written = await draft.writeService.write(selection);

			expect(written.failure()).toBeDefined();
			expect(await fs.exists(abs("default.project.json"))).toBe(false);
		} finally {
			draft[Symbol.dispose]();
		}
	});

	it("should keep the config checks registered on the services it rebuilds", async () => {
		const config = abs("default.rogen.json");
		const registration = root
			.invokeFunction((accessor) => accessor.get(ConfigService))
			.registerFileCheck(({ file }) => [
				errorDiagnostic("legacy.config", { resource: file }, "old"),
			]);
		const draft = rootWriteService().openDraft({
			files: new Map([[config, JSON.stringify({ source: "src" })]]),
			directories: [],
			moves: [],
		});
		try {
			const entry = await draft.configService.read(config);

			expect(
				entry.status === "broken" &&
					entry.errors.map(({ code }) => code)
			).toContain("legacy.config");
		} finally {
			draft[Symbol.dispose]();
			registration[Symbol.dispose]();
		}
	});

	it("should find the default config of a folder in the draft", async () => {
		const draft = openDraft();
		try {
			const selection = (await draft.configService.select([])).unwrap();

			await selection.reload([abs("default.rogen.json")]);

			expect(selection.entries.map(({ file }) => file)).toEqual([
				abs("default.rogen.json"),
			]);
		} finally {
			draft[Symbol.dispose]();
		}
	});

	it("should run a folder check over the draft's files", async () => {
		const old = abs("old.json");
		checks.registerFolderCheck(async (folder, files) =>
			(await files.exists(old))
				? [errorDiagnostic("test.stale", { resource: old }, "is old.")]
				: []
		);
		const draft = rootWriteService().openDraft({
			files: new Map([[old, "{}"]]),
			directories: [],
			moves: [],
		});
		try {
			expect(
				(await draft.configService.staleConfigsIn(abs())).map(
					({ code }) => code
				)
			).toEqual(["test.stale"]);
		} finally {
			draft[Symbol.dispose]();
		}
	});

	it("should dispose its scope when a service of the draft can't be built", () => {
		let builds = 0;
		class OnceConfigService extends CoreConfigService {
			constructor(
				...args: ConstructorParameters<typeof CoreConfigService>
			) {
				super(...args);
				if (++builds > 1) throw new Error("can't build");
			}
		}
		root[Symbol.dispose]();
		root = instantiationOf(
			[FileSystemService, fs],
			[EnvironmentService, new MockEnvironmentService(abs())],
			[ToolchainService, toolchainOf(fs)],
			[IndexService, new SyncDescriptor(CoreIndexService)],
			[ConfigService, new SyncDescriptor(OnceConfigService, [checks])],
			[WriteService, new SyncDescriptor(CoreWriteService)]
		);
		const writeService = rootWriteService();
		const disposed = jest.spyOn(
			CoreInstantiationService.prototype,
			Symbol.dispose
		);

		expect(() =>
			writeService.openDraft({
				files: new Map(),
				directories: [],
				moves: [],
			})
		).toThrow("can't build");
		expect(disposed).toHaveBeenCalledTimes(1);
	});

	it("should leave the services outside the draft reading the disk", async () => {
		const outside = root.invokeFunction((accessor) =>
			accessor.get(ConfigService)
		);
		const draft = openDraft();
		draft[Symbol.dispose]();

		expect(
			(await outside.select([abs("default.rogen.json")])).isErr()
		).toBe(true);
	});
});
