import { toNative } from "../../../base/path.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { EnvironmentService } from "../../../platform/environment/environment-service.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { instantiationOf } from "../../../platform/instantiation/__tests__/instantiation-of.js";
import { MockProductService } from "../../../platform/product/__tests__/mock-product-service.js";
import { ProductService } from "../../../platform/product/product-service.js";
import { MockRequestService } from "../../../platform/request/__tests__/mock-request-service.js";
import { RequestService } from "../../../platform/request/request-service.js";
import { ToolchainService } from "../../toolchain/toolchain-service.js";
import { toolchainOf } from "../../toolchain/__tests__/toolchain-of.js";
import { CoreUpdateService } from "../core-update-service.js";

const CACHE_FILE = "/mock/cache/rogen/update-check.json";
const RELEASES_URL =
	"https://api.github.com/repos/LDGerrits/rogen/releases?per_page=30";
const DAY = 24 * 60 * 60 * 1000;

describe("CoreUpdateService", () => {
	let fs: MemoryFileSystemService;
	let requests: MockRequestService;
	let clock: number;

	const serviceOf = (
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
		return instantiationOf(
			[FileSystemService, fs],
			[RequestService, requests],
			[ProductService, new MockProductService(version)],
			[
				EnvironmentService,
				new MockEnvironmentService(cwd, undefined, checks),
			],
			[ToolchainService, toolchainOf(fs)]
		).createInstance(
			CoreUpdateService,
			options.installDir ?? "/home/me/.rokit/tool-storage/rogen/dist",
			() => clock
		);
	};

	const check = (options: Parameters<typeof serviceOf>[0] = {}) =>
		serviceOf(options).check();

	// A listing as of now, so the check has no reason to ask again.
	const publish = async (versions: readonly string[]) => {
		let known: Record<string, unknown> = {};
		try {
			known = JSON.parse(await fs.readFile(CACHE_FILE)) as typeof known;
		} catch {
			known = {};
		}
		await fs.writeFile(
			CACHE_FILE,
			JSON.stringify({ ...known, checkedAt: clock, versions })
		);
	};

	const answer = (...tags: string[]) =>
		requests.responses.set(RELEASES_URL, {
			status: 200,
			contentType: "application/json",
			body: new TextEncoder().encode(
				JSON.stringify(tags.map((tag_name) => ({ tag_name })))
			),
		});

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		requests = new MockRequestService();
		clock = 1_000 * DAY;
		await fs.createDirectory("/repo/game");
	});

	describe("the listing", () => {
		it("should answer from the cache while a check beside it asks, then from what it found", async () => {
			answer("v2.0.3", "v2.0.0");
			const service = serviceOf();

			expect(await service.check()).toBeUndefined();
			await service.whenRefreshed();

			expect(requests.requested).toEqual([RELEASES_URL]);
			expect(await service.check()).toContain("Rogen 2.0.3 is out");
		});

		it("should not ask again within a day, and ask once after it", async () => {
			answer("v2.0.1");
			const service = serviceOf();
			await service.check();
			await service.whenRefreshed();

			clock += DAY - 1;
			await service.check();
			await service.whenRefreshed();
			expect(requests.requested).toHaveLength(1);

			clock += 1;
			await service.check();
			await service.whenRefreshed();
			expect(requests.requested).toHaveLength(2);
		});

		it("should ask once for checks that overlap", async () => {
			answer("v2.0.1");
			const service = serviceOf();

			await Promise.all([service.check(), service.check()]);
			await service.whenRefreshed();

			expect(requests.requested).toHaveLength(1);
		});

		it("should still announce what the check found, and say it once", async () => {
			answer("v2.1.0-rc-1");
			const service = serviceOf({ version: "2.0.0-beta.1" });
			await service.check();
			await service.whenRefreshed();

			expect(await service.check()).toContain("Rogen 2.1.0-rc-1 is out");
			expect(await service.check()).toBeUndefined();
		});

		it("should say nothing when no check has ever worked", async () => {
			const service = serviceOf();

			expect(await service.check()).toBeUndefined();
			await service.whenRefreshed();
			expect(await service.check()).toBeUndefined();
		});
	});

	describe("which release", () => {
		it("should name the newest release when the installed one is older", async () => {
			await publish(["2.0.3", "2.0.1", "2.0.2"]);

			expect(await check()).toEqual(
				"Rogen 2.0.3 is out (you have 2.0.0). See https://github.com/LDGerrits/rogen/releases/tag/v2.0.3"
			);
		});

		it.each([
			["the same release", ["2.0.0"]],
			["only older releases", ["1.4.4", "2.0.0-beta.1"]],
			["nothing published", []],
		])("should say nothing with %s", async (_, versions) => {
			await publish(versions);

			expect(await check()).toBeUndefined();
		});

		it("should not tell a stable version about a prerelease", async () => {
			await publish(["2.1.0-beta.1", "2.0.0"]);

			expect(await check()).toBeUndefined();
		});

		it("should tell a prerelease about a later prerelease and the release", async () => {
			await publish(["2.0.0-beta.2"]);
			expect(await check({ version: "2.0.0-beta.1" })).toContain(
				"Rogen 2.0.0-beta.2 is out (you have 2.0.0-beta.1)."
			);

			await publish(["2.0.0-beta.2", "2.0.0"]);
			expect(await check({ version: "2.0.0-beta.1" })).toContain(
				"Rogen 2.0.0 is out"
			);
		});

		it("should say nothing when the installed version is not known", async () => {
			await publish(["2.0.3"]);

			expect(await check({ version: "unknown" })).toBeUndefined();
		});
	});

	describe("when it speaks", () => {
		beforeEach(async () => {
			await publish(["2.0.3"]);
		});

		it("should say nothing, and ask nothing, for a run that does not check", async () => {
			clock += DAY;

			expect(await check({ checks: false })).toBeUndefined();
			expect(requests.requested).toEqual([]);
		});

		it("should say it once for a version", async () => {
			expect(await check()).toBeDefined();
			expect(await check()).toBeUndefined();
		});

		it("should say it again for a newer version", async () => {
			await check();
			await publish(["2.0.4", "2.0.3"]);

			expect(await check()).toContain("Rogen 2.0.4 is out");
		});
	});

	describe("the fix", () => {
		beforeEach(async () => {
			await publish(["2.0.3"]);
		});

		it("should name the Rokit file and the new pin", async () => {
			await fs.writeFile(
				"/repo/game/rokit.toml",
				'[tools]\nrogen = "ldgerrits/rogen@2.0.0"\n'
			);

			expect(await check()).toEqual(
				'Rogen 2.0.3 is out (you have 2.0.0). Update the pin in rokit.toml: rogen = "ldgerrits/rogen@2.0.3". Then run rokit install.'
			);
		});

		it("should find the file in a folder above, and the name the tool runs as", async () => {
			await fs.writeFile(
				"/repo/aftman.toml",
				'[tools]\nr = "LDGerrits/Rogen@2.0.0"\n'
			);

			expect(await check()).toContain(
				`Update the pin in ${toNative("../aftman.toml")}: r = "ldgerrits/rogen@2.0.3". Then run aftman install.`
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
			).toEqual(
				"Rogen 2.0.3 is out (you have 2.0.0). Update with: npm i @ldgerrits/rogen@2.0.3"
			);
		});

		it("should name a global npm install as one", async () => {
			expect(
				await check({
					installDir: "/usr/lib/node_modules/@ldgerrits/rogen/dist",
				})
			).toEqual(
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
