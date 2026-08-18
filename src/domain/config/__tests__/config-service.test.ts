import { ParsedArgsSchema } from "../../../platform/environment/args.js";
import { NativeEnvironmentService } from "../../../platform/environment/environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { RogenConfigService } from "../config-service.js";

describe("RogenConfigService", () => {
	let memFs: MemoryFileSystemService;

	const createEnvironment = (args: Record<string, unknown> = {}) => {
		const parsedArgs = ParsedArgsSchema.parse({ _: [], ...args });
		return new NativeEnvironmentService(parsedArgs, "/mock/cwd");
	};

	beforeEach(() => {
		memFs = new MemoryFileSystemService();
	});

	it("should use the async factory to create a fully initialized service", async () => {
		const environment = createEnvironment();

		const result = await RogenConfigService.create(memFs, environment);

		expect(result.isOk()).toBe(true);

		const configService = result.unwrap();
		expect(configService.getValue().source).toEqual(["src"]);
	});

	it("should parse file contents and merge with CLI overrides", async () => {
		await memFs.writeFile(
			"/mock/cwd/.rogen.json",
			JSON.stringify({ casing: "PascalCase", source: "file-src" })
		);

		const environment = createEnvironment({ source: ["cli-src"] });

		const result = await RogenConfigService.create(memFs, environment);
		const configService = result.unwrap();

		expect(configService.getValue().casing).toBe("PascalCase");
		expect(configService.getValue().source).toEqual(["cli-src"]);
	});
});
