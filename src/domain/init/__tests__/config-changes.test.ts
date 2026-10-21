import path from "path";
import { UsageError } from "../../../base/errors.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { Luau } from "../../toolchain/luau.js";
import { RobloxTs } from "../../toolchain/roblox-ts.js";
import { Language } from "../../toolchain/toolchain.js";
import { ChangeRequest, ConfigChanges } from "../config-changes.js";
import { ConfigEdit } from "../config-edit.js";
import { directory, directoryOf, DirectorySpec } from "./init-fixtures.js";

const CONFIG = `{
	// the routes of the game
	"rogen": {
		"routes": { "server": "ServerScriptService", "client": "StarterPlayer/StarterPlayerScripts", "shared": "ReplicatedStorage/shared", "*": "ReplicatedStorage/shared" }
	}
}
`;

describe("ConfigChanges", () => {
	let files: MemoryFileSystemService;

	beforeEach(async () => {
		files = new MemoryFileSystemService();
		await files.createDirectory(directory);
	});

	const write = (file: string, content = "") =>
		files.writeFile(path.join(directory, file), content);

	const apply = async (
		request: ChangeRequest,
		text = CONFIG,
		options: {
			language?: Language;
			spec?: DirectorySpec;
			routed?: boolean;
		} = {}
	) => {
		const edit = ConfigEdit.of("default.rogen.json", text)!;
		const plan = await new ConfigChanges(
			files,
			directoryOf(options.spec),
			edit,
			options.language ?? new Luau(),
			options.routed ?? true
		).apply(request);
		return { plan, edit };
	};

	describe("routes", () => {
		it("should add a standard route and keep the comment", async () => {
			const { plan } = await apply({ routes: ["serverStorage"] });

			expect(plan.config?.changes).toEqual([
				"added routes.serverStorage",
			]);
			expect(plan.config?.content).toContain("// the routes of the game");
			expect(plan.config?.content).toContain(
				'"serverStorage": "ServerStorage"'
			);
		});

		it("should spell a new route as the routes there are spelled", async () => {
			const { plan } = await apply(
				{ routes: ["serverStorage"] },
				'{ "rogen": { "routes": { "Server": "ServerScriptService" } } }'
			);

			expect(plan.config?.changes).toEqual([
				"added routes.ServerStorage",
			]);
		});

		it("should say a route is there already, and change nothing", async () => {
			const { plan } = await apply({ routes: ["server"] });

			expect(plan.config).toBeUndefined();
			expect(plan.notes).toEqual(["routes.server is there already."]);
		});

		it("should not move a route that goes elsewhere", async () => {
			const { plan } = await apply(
				{ routes: ["server"] },
				'{ "rogen": { "routes": { "server": "Elsewhere" } } }'
			);

			expect(plan.config).toBeUndefined();
			expect(plan.notes[0]).toContain("routes.server goes to Elsewhere");
		});

		it("should take a standard route off and leave routes of your own", async () => {
			const { plan } = await apply(
				{ unroutes: ["client"] },
				'{ "rogen": { "routes": { "client": "StarterPlayer/StarterPlayerScripts", "tools": "ServerStorage/Tools" } } }'
			);

			expect(plan.config?.changes).toEqual(["removed routes.client"]);
			expect(plan.config?.content).toContain('"tools"');
			expect(plan.config?.content).not.toContain('"client"');
		});

		it("should refuse to take off a route that is not standard", async () => {
			await expect(
				apply(
					{ unroutes: ["client"] },
					'{ "rogen": { "routes": { "client": "Elsewhere" } } }'
				)
			).rejects.toThrow("goes to Elsewhere");
		});

		it("should name the routes there are when an id is wrong", async () => {
			await expect(apply({ routes: ["nope"] })).rejects.toThrow(
				UsageError
			);
		});

		it("should refuse routes in a project that takes none", async () => {
			await expect(
				apply({ routes: ["server"] }, "{}", { routed: false })
			).rejects.toThrow("takes routes");
		});
	});

	describe("files that match no route", () => {
		it("should leave them out by taking the fallback off", async () => {
			const { plan } = await apply({ unmatched: "leave" });

			expect(plan.config?.changes).toEqual(["removed routes.*"]);
		});

		it("should put them in the shared route", async () => {
			const { plan } = await apply(
				{ unmatched: "shared" },
				'{ "rogen": { "routes": { "server": "ServerScriptService" } } }'
			);

			expect(plan.config?.changes).toEqual(["added routes.*"]);
			expect(plan.config?.content).toContain(
				'"*": "ReplicatedStorage/Shared"'
			);
		});

		it("should leave a fallback of your own where it goes", async () => {
			const { plan } = await apply(
				{ unmatched: "shared" },
				'{ "rogen": { "routes": { "server": "ServerScriptService", "*": "ReplicatedStorage/Custom" } } }'
			);

			expect(plan.config).toBeUndefined();
			expect(plan.notes[0]).toContain(
				"routes.* goes to ReplicatedStorage/Custom"
			);
		});

		it("should refuse to leave files out when there is no other route", async () => {
			await expect(
				apply(
					{ unmatched: "leave" },
					'{ "rogen": { "routes": { "*": "ReplicatedStorage/shared" } } }'
				)
			).rejects.toThrow("no route to apply to");
		});
	});

	describe("source paths", () => {
		it("should add a folder to the default src", async () => {
			const { plan } = await apply({ sourcePaths: ["lib"] });

			expect(plan.config?.changes).toEqual(["added sourcePaths lib"]);
			expect(plan.config?.content).toContain('"sourcePaths": [');
			expect(plan.directories).toEqual(["lib"]);
		});

		it("should take a folder off and list the scripts it no longer builds", async () => {
			await write("lib/Util.luau");
			await write("lib/Other.server.luau");

			const { plan } = await apply(
				{ unsourcePaths: ["lib"] },
				'{ "rogen": { "routes": {}, "sourcePaths": ["src", "lib"] } }'
			);

			expect(plan.config?.changes).toEqual(["removed sourcePaths lib"]);
			expect(plan.warnings[0].message).toContain("Other.server.luau");
			expect(plan.warnings[0].message).toContain("Util.luau");
		});

		it("should refuse to take off a folder that is not a source path", async () => {
			await expect(apply({ unsourcePaths: ["lib"] })).rejects.toThrow(
				"lib is not a source path"
			);
		});

		it("should refuse to take off the last one", async () => {
			await expect(apply({ unsourcePaths: ["src"] })).rejects.toThrow(
				"at least one source path"
			);
		});

		it("should refuse a folder inside a source path", async () => {
			await expect(apply({ sourcePaths: ["src/lib"] })).rejects.toThrow(
				"inside src"
			);
		});

		it("should refuse several folders for a compiler", async () => {
			await expect(
				apply({ sourcePaths: ["lib"] }, CONFIG, {
					language: new RobloxTs({}, true),
				})
			).rejects.toThrow("roblox-ts compiles one folder");
		});
	});

	describe("Darklua", () => {
		it.each([true, false])(
			"should refuse to change it with darklua: %s, since init writes no second config file yet",
			async (darklua) => {
				await expect(apply({ darklua })).rejects.toThrow(UsageError);
			}
		);
	});

	describe("packages", () => {
		const wally = {
			workspace: {
				packageManager: "wally" as const,
				packageDirs: ["Packages"],
			},
		};

		it("should mount a package folder the tree lacks", async () => {
			const { plan } = await apply({ packages: ["Packages"] }, CONFIG, {
				spec: wally,
			});

			expect(plan.config?.changes).toEqual([
				"added tree.ReplicatedStorage.Packages",
			]);
			expect(plan.config?.content).toContain('"$path"');
		});

		it("should say a folder is mounted already", async () => {
			const { plan } = await apply(
				{ packages: ["Packages"] },
				'{ "tree": { "$className": "DataModel", "ReplicatedStorage": { "Packages": { "$path": "Packages" } } } }',
				{ spec: wally }
			);

			expect(plan.config).toBeUndefined();
			expect(plan.notes).toEqual(["Packages is mounted already."]);
		});

		it("should refuse a folder that is not a package folder", async () => {
			await expect(
				apply({ packages: ["Nope"] }, CONFIG, { spec: wally })
			).rejects.toThrow("not a folder to mount");
		});
	});
});
