import { jest } from "@jest/globals";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockProductService } from "../../../platform/product/__tests__/mock-product-service.js";
import { MockReleaseService } from "../../../platform/release/__tests__/mock-release-service.js";
import { CoreToolchainService } from "../../toolchain/core-toolchain-service.js";
import { CoreUpdateService } from "../core-update-service.js";

describe("CoreUpdateService", () => {
	let fs: MemoryFileSystemService;
	let releases: MockReleaseService;

	const check = (
		options: {
			version?: string;
			checks?: boolean;
			installDir?: string;
			cwd?: string;
		} = {}
	) => {
		const {
			version = "2.0.0",
			checks = true,
			cwd = "/repo/game",
		} = options;
		return new CoreUpdateService(
			releases,
			new MockProductService(version),
			new MockEnvironmentService(
				cwd,
				undefined,
				true,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				checks
			),
			new CoreToolchainService(fs),
			fs,
			options.installDir ?? "/home/me/.rokit/tool-storage/rogen/dist"
		).check();
	};

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo/game");
		releases = new MockReleaseService();
	});

	describe("which release", () => {
		it("should name the newest release when the installed one is older", async () => {
			releases.versions = ["2.0.3", "2.0.1", "2.0.2"];

			expect(await check()).toBe(
				"Rogen 2.0.3 is out (you have 2.0.0). See https://github.com/LDGerrits/rogen/releases/tag/v2.0.3"
			);
		});

		it.each([
			["the same release", ["2.0.0"]],
			["only older releases", ["1.4.4", "2.0.0-beta.1"]],
			["nothing published", []],
		])("should say nothing with %s", async (_, versions) => {
			releases.versions = versions;

			expect(await check()).toBeUndefined();
		});

		it("should not tell a stable version about a prerelease", async () => {
			releases.versions = ["2.1.0-beta.1", "2.0.0"];

			expect(await check()).toBeUndefined();
		});

		it("should tell a prerelease about a later prerelease and the release", async () => {
			releases.versions = ["2.0.0-beta.2"];
			expect(await check({ version: "2.0.0-beta.1" })).toContain(
				"Rogen 2.0.0-beta.2 is out (you have 2.0.0-beta.1)."
			);

			releases.versions = ["2.0.0-beta.2", "2.0.0"];
			expect(await check({ version: "2.0.0-beta.1" })).toContain(
				"Rogen 2.0.0 is out"
			);
		});

		it("should say nothing when the installed version is not known", async () => {
			releases.versions = ["2.0.3"];

			expect(await check({ version: "unknown" })).toBeUndefined();
		});
	});

	describe("when it speaks", () => {
		beforeEach(() => {
			releases.versions = ["2.0.3"];
		});

		it("should say nothing, and read nothing, for a run that does not check", async () => {
			const published = jest.spyOn(releases, "published");

			expect(await check({ checks: false })).toBeUndefined();
			expect(published).not.toHaveBeenCalled();
		});

		it("should say it once for a version", async () => {
			expect(await check()).toBeDefined();
			expect(await check()).toBeUndefined();
		});

		it("should say it again for a newer version", async () => {
			await check();
			releases.versions = ["2.0.4", "2.0.3"];

			expect(await check()).toContain("Rogen 2.0.4 is out");
		});
	});

	describe("the fix", () => {
		beforeEach(() => {
			releases.versions = ["2.0.3"];
		});

		it("should name the Rokit file and the new pin", async () => {
			await fs.writeFile(
				"/repo/game/rokit.toml",
				'[tools]\nrogen = "ldgerrits/rogen@2.0.0"\n'
			);

			expect(await check()).toBe(
				'Rogen 2.0.3 is out (you have 2.0.0). Update the pin in rokit.toml: rogen = "ldgerrits/rogen@2.0.3". Then run rokit install.'
			);
		});

		it("should find the file in a folder above, and the name the tool runs as", async () => {
			await fs.writeFile(
				"/repo/aftman.toml",
				'[tools]\nr = "LDGerrits/Rogen@2.0.0"\n'
			);

			expect(await check()).toContain(
				'Update the pin in ../aftman.toml: r = "ldgerrits/rogen@2.0.3". Then run aftman install.'
			);
		});

		it("should write a Foreman pin as Foreman reads it", async () => {
			await fs.writeFile(
				"/repo/game/foreman.toml",
				'[tools]\nrogen = { github = "ldgerrits/rogen", version = "2.0.0" }\n'
			);

			expect(await check()).toContain(
				'foreman.toml: rogen = { github = "ldgerrits/rogen", version = "2.0.3" }. Then run foreman install.'
			);
		});

		it("should skip a file that pins other tools", async () => {
			await fs.writeFile(
				"/repo/game/rokit.toml",
				'[tools]\nrojo = "rojo-rbx/rojo@7.7.1"\n'
			);

			expect(await check()).toContain("See https://github.com/");
		});

		it("should name npm for an install into the project", async () => {
			await fs.writeFile("/repo/game/package.json", "{}");
			await fs.writeFile(
				"/repo/game/rokit.toml",
				'[tools]\nrogen = "ldgerrits/rogen@2.0.0"\n'
			);

			expect(
				await check({
					installDir: "/repo/game/node_modules/@ldgerrits/rogen/dist",
				})
			).toBe(
				"Rogen 2.0.3 is out (you have 2.0.0). Update with: npm i @ldgerrits/rogen@2.0.3"
			);
		});

		it("should name a global npm install as one", async () => {
			expect(
				await check({
					installDir: "/usr/lib/node_modules/@ldgerrits/rogen/dist",
				})
			).toBe(
				"Rogen 2.0.3 is out (you have 2.0.0). Update with: npm i -g @ldgerrits/rogen@2.0.3"
			);
		});

		it("should know node_modules by Windows separators too", async () => {
			expect(
				await check({
					installDir:
						"C:\\game\\node_modules\\@ldgerrits\\rogen\\dist",
				})
			).toContain("npm i -g @ldgerrits/rogen@2.0.3");
		});
	});
});
