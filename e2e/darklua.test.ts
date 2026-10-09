import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import {
	bundleCli,
	createProject,
	describeWithDarklua,
	invocation,
	writeProjectFile,
} from "./harness.js";

const darkluaConfig = (sourcemap: string) =>
	JSON.stringify({
		rules: [
			{
				rule: "convert_require",
				current: { name: "path" },
				target: {
					name: "roblox",
					rojo_sourcemap: sourcemap,
					indexing_style: "property",
				},
			},
		],
	});

interface NextSteps {
	readonly run: readonly string[];
	readonly darklua: readonly string[];
}

describeWithDarklua("end to end Darklua", () => {
	let bundle: ReturnType<typeof bundleCli>;
	let project: ReturnType<typeof createProject>;

	const run = (command: string, args: readonly string[]) => {
		const result = spawnSync(command, args, {
			cwd: project.dir,
			encoding: "utf8",
			timeout: 60_000,
		});
		if (result.status !== 0)
			throw new Error(
				`${command} ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`
			);
		return result.stdout;
	};

	const rogen = (args: readonly string[]) => {
		const [command, fullArgs] = invocation(bundle.cli, args);
		return run(command, fullArgs);
	};

	const read = (file: string) =>
		fs.readFileSync(path.join(project.dir, file), "utf8");

	beforeAll(() => {
		bundle = bundleCli();
	});

	afterAll(() => {
		bundle.dispose();
	});

	beforeEach(() => {
		project = createProject({
			".darklua.json": darkluaConfig("./sourcemap.json"),
			"src/Shared/Damage.luau": "return {}",
		});
		run("git", ["init", "-q"]);
		rogen(["init", "--yes"]);
	});

	afterEach(() => {
		project.dispose();
	});

	it("should convert a place's requires into its shared code by following the steps init gives", () => {
		const { nextSteps } = JSON.parse(
			rogen(["init", "lobby", "--json"])
		) as {
			readonly nextSteps: NextSteps;
		};
		writeProjectFile(
			project.dir,
			"places/lobby/src/Server/Greeter.server.luau",
			'local Damage = require("../../../../src/Shared/Damage")\nprint(Damage)'
		);
		rogen(["build"]);

		const sourcemapCommand = nextSteps.run.find((step) =>
			step.startsWith("rojo sourcemap")
		);
		const [, ...sourcemapArgs] = sourcemapCommand!
			.replace(" --watch", "")
			.split(" ");
		run("rojo", sourcemapArgs);
		const sourcemap = sourcemapArgs[sourcemapArgs.indexOf("--output") + 1];
		const [, ...firstArgs] = nextSteps.darklua[0].split(" ");
		const config = firstArgs[firstArgs.indexOf("--config") + 1];
		writeProjectFile(
			project.dir,
			config,
			darkluaConfig(`./${path.posix.basename(sourcemap)}`)
		);
		for (const step of nextSteps.darklua) {
			const [, ...args] = step.split(" ");
			run("darklua", args);
		}

		expect(
			read("dist/lobby/places/lobby/src/Server/Greeter.server.luau")
		).toContain("game:GetService('ReplicatedStorage').Shared.Damage");
	});
});
