import { ConfigService } from "../../../platform/config/config-service.js";
import { ConfigResolver } from "../config-resolver.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ConfigProvider } from "../../../platform/config/config-provider.js";
import { ok, ResultError } from "../../../base/result.js";
import { ConfigLoader } from "../config-loader.js";
import { WorkspaceService } from "../../workspace/workspace-service.js";

describe("RogenConfigLoader", () => {
	let memFs: MemoryFileSystemService;
	let resolver: ConfigResolver;
	let configService: ConfigService;
	let workspaceService: WorkspaceService;

	beforeEach(() => {
		memFs = new MemoryFileSystemService();
		resolver = new ConfigResolver(memFs);
		configService = new ConfigService();
		workspaceService = new WorkspaceService("/mock", memFs);
	});

	it("should load, resolve dependencies, and validate against the Zod schema successfully", async () => {
		const mockProvider: ConfigProvider = {
			name: "Mock",
			load: async () => ok({ casing: "PascalCase", source: "lib" }),
		};
		configService.addProvider(mockProvider);

		const loader = new ConfigLoader(
			configService,
			resolver,
			workspaceService,
			"/mock"
		);
		const result = await loader.load();

		expect(result.isOk()).toBe(true);
		const finalConfig = result.unwrap();

		expect(finalConfig.casing).toBe("PascalCase");
		expect(finalConfig.source).toEqual(["lib"]);
		expect(finalConfig.verbatim).toBe(false);
	});

	it("should return an error if Zod validation fails", async () => {
		const badProvider: ConfigProvider = {
			name: "BadMock",
			load: async () => ok({ verbatim: "not-a-boolean" }),
		};
		configService.addProvider(badProvider);

		const loader = new ConfigLoader(
			configService,
			resolver,
			workspaceService,
			"/mock"
		);
		const result = await loader.load();

		expect(result.isErr()).toBe(true);
		expect((result as ResultError<Error>).error.message).toContain(
			"Configuration validation failed"
		);
	});
});
