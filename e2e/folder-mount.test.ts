import { spawnSync } from "child_process";
import { describeWithRojo } from "../src/domain/rojo/__tests__/rojo-cli.js";
import {
	bundleCli,
	createProject,
	invocation,
	sourcemapTree,
	writeProjectFile,
} from "./harness.js";

describeWithRojo("end to end folder mounts", () => {
	let bundle: ReturnType<typeof bundleCli>;
	let project: ReturnType<typeof createProject>;

	beforeAll(() => {
		bundle = bundleCli();
	});

	afterAll(() => {
		bundle.dispose();
	});

	beforeEach(() => {
		project = createProject({
			"default.rogen.json": JSON.stringify({
				rogen: {
					sourcePaths: ["src"],
					routes: {
						Server: "ServerScriptService",
						Client: "StarterPlayer/StarterPlayerScripts",
					},
				},
			}),
			"src/Inventory/Server/Save.luau": "",
			"src/Inventory/Client/Show.client.luau": "",
		});
	});

	afterEach(() => {
		project.dispose();
	});

	it("should let plain Rojo see a file added to a routing folder after the build", async () => {
		const [command, args] = invocation(bundle.cli, ["write"]);
		spawnSync(command, args, { cwd: project.dir });

		writeProjectFile(project.dir, "src/Inventory/Server/Load.luau");

		const tree = await sourcemapTree(project.dir, "default.project.json");
		expect(tree).toContain(
			"Load: ModuleScript  <- src/Inventory/Server/Load.luau"
		);
	}, 30_000);
});
