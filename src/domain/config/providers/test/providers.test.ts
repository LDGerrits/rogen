import { jest } from "@jest/globals";
import { CliConfigProvider } from "../cli.js";
import { ToolchainProvider } from "../toolchain.js";
import {
	ToolchainProfile,
	WorkspaceService,
} from "../../../workspace/workspace-service.js";
import { MemoryFileSystemService } from "../../../../platform/fs/memory-file-system-service.js";

describe("Domain Config Providers", () => {
	describe("CliConfigProvider", () => {
		it("should map CLI arguments to a raw mode overrides object", async () => {
			const cliArgs = { source: ["cli-src"], build: "cli-out" };
			const provider = new CliConfigProvider("/mock", cliArgs);

			const result = await provider.load();

			expect(result.isOk()).toBe(true);
			const config = result.unwrap() as {
				source?: string[];
				luau?: { build?: string };
			};

			expect(config.source).toEqual(["cli-src"]);
			expect(config.luau?.build).toBe("cli-out");
		});
	});

	describe("ToolchainProvider", () => {
		it("should wrap the workspace toolchain detection in the provider format", async () => {
			const memFs = new MemoryFileSystemService();
			const workspaceService = new WorkspaceService("/mock", memFs);

			jest.spyOn(workspaceService, "detectToolchain").mockResolvedValue({
				isTs: true,
				isWally: false,
				isPesde: false,
				isDarklua: true,
			});

			const provider = new ToolchainProvider(workspaceService);
			const result = await provider.load();

			expect(result.isOk()).toBe(true);

			const payload = result.unwrap() as { toolchain: ToolchainProfile };
			expect(payload.toolchain.isTs).toBe(true);
		});
	});
});
