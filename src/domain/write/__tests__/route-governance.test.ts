import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { RouteGovernance } from "../route-governance.js";
import {
	ROUTER_ROUTES,
	abs,
	absPosix as at,
	configOf,
	indexOf,
	pipelineOf,
	writeFiles,
} from "./fixtures.js";

describe("RouteGovernance", () => {
	let fs: MemoryFileSystemService;

	const governanceOf = async (
		...paths: string[]
	): Promise<RouteGovernance> => {
		await writeFiles(fs, ...paths);
		return (
			await pipelineOf(fs, await indexOf(fs, [abs("src")])).place(
				configOf({
					routes: { ...ROUTER_ROUTES, "*.tsx": "StarterGui" },
					compiledPath: abs("out"),
				})
			)
		).unwrap().governance;
	};

	beforeEach(() => {
		fs = new MemoryFileSystemService();
	});

	describe("within", () => {
		it("should name the route a routing folder applies inside it, and none above it", async () => {
			const governance = await governanceOf("src/F/server/A.luau");

			expect(governance.within(at("src/F/server"))).toBe("server");
			expect(governance.within(at("src/F"))).toBeUndefined();
			expect(governance.within(at("src"))).toBeUndefined();
		});

		it("should count a marker file in the folder itself and in every folder below", async () => {
			const governance = await governanceOf(
				"src/F/@client",
				"src/F/Sub/A.luau"
			);

			expect(governance.within(at("src/F"))).toBe("client");
			expect(governance.within(at("src/F/Sub"))).toBe("client");
		});

		it("should count a marker file in the source path", async () => {
			const governance = await governanceOf("src/@server", "src/A.luau");

			expect(governance.within(at("src"))).toBe("server");
		});

		it("should name the route of an @ folder", async () => {
			const governance = await governanceOf(
				"src/Net@server/Deep/A.luau",
				"src/@client/B.luau"
			);

			expect(governance.within(at("src/Net@server/Deep"))).toBe("server");
			expect(governance.within(at("src/@client"))).toBe("client");
		});

		it("should name the outermost route when routes nest", async () => {
			const governance = await governanceOf(
				"src/server/client/A.luau",
				"src/server/X/@client",
				"src/server/X/B.luau"
			);

			expect(governance.within(at("src/server/client"))).toBe("server");
			expect(governance.within(at("src/server/X"))).toBe("server");
		});

		it("should not count a file's suffix or a pattern its name matches", async () => {
			const governance = await governanceOf(
				"src/F/A@server.luau",
				"src/G/Boot.client.luau",
				"src/Shop/Hud.tsx"
			);

			expect(governance.within(at("src/F"))).toBeUndefined();
			expect(governance.within(at("src/G"))).toBeUndefined();
			expect(governance.within(at("src/Shop"))).toBeUndefined();
		});

		it("should name the route of a folder that holds no routed file", async () => {
			const governance = await governanceOf("src/server/Ui/@sevrer");

			expect(governance.within(at("src/server/Ui"))).toBe("server");
		});
	});

	describe("above", () => {
		it("should leave out the resource's own name and the markers in it", async () => {
			const governance = await governanceOf(
				"src/Net@client/Foo@server.luau",
				"src/Odd/Mk/@server",
				"src/Odd/Mk/A.luau"
			);

			expect(governance.above(at("src/Net@client"))).toBeUndefined();
			expect(governance.above(at("src/Odd/Mk"))).toBeUndefined();
			expect(governance.above(at("src/Odd/Mk/A.luau"))).toBe("server");
			expect(governance.above(at("src/Net@client/Foo@server.luau"))).toBe(
				"client"
			);
		});

		it("should count a marker file beside the resource", async () => {
			const governance = await governanceOf(
				"src/F/@server",
				"src/F/Ui.client/A.luau"
			);

			expect(governance.above(at("src/F/Ui.client"))).toBe("server");
		});
	});
});
