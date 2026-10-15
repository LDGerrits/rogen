import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import {
	describeWithRojo,
	makeRojoDir,
} from "../src/domain/rojo/__tests__/rojo-cli.js";
import { bundleCli, invocation } from "./harness.js";
import { PROJECTS_DIR } from "./rojo-conformance.js";

const projects = fs
	.readdirSync(PROJECTS_DIR, { withFileTypes: true })
	.filter(
		(entry) =>
			entry.isDirectory() &&
			fs.existsSync(
				path.join(PROJECTS_DIR, entry.name, "default.project.json")
			)
	)
	.map((entry) => entry.name);

const FORMATS = ["rbxl", "rbxm", "rbxlx"];
const SOURCEMAP_FLAGS = [
	[],
	["--include-non-scripts"],
	["--absolute"],
	["--include-non-scripts", "--absolute"],
];

interface Run {
	readonly status: number | null;
	readonly stdout: string;
}

describeWithRojo("Rogen and Rojo on the same project", () => {
	let bundle: ReturnType<typeof bundleCli>;
	let parent: string;

	const rogen = (
		cwd: string,
		args: readonly string[],
		input?: string
	): Run => {
		const [command, rest] = invocation(bundle.cli, args);
		const result = spawnSync(command, [...rest], {
			cwd,
			encoding: "utf8",
			input,
			timeout: 60_000,
		});
		return { status: result.status, stdout: result.stdout };
	};

	const rojo = (cwd: string, args: string[], input?: string): Run => {
		const result = spawnSync("rojo", args, {
			cwd,
			encoding: "utf8",
			input,
			timeout: 60_000,
		});
		return { status: result.status, stdout: result.stdout };
	};

	beforeAll(() => {
		bundle = bundleCli();
		parent = makeRojoDir("rogen-parity-");
	});

	afterAll(() => {
		bundle.dispose();
		fs.rmSync(parent, { recursive: true, force: true });
	});

	/** Two copies of Rojo's build test `name`: `rojo` holds its project file, `rogen` holds it as a `rogen.json`. */
	const copies = (name: string) => {
		const dir = fs.mkdtempSync(path.join(parent, `${name}-`));
		const [byRojo, byRogen] = ["rojo", "rogen"].map((side) => {
			const copy = path.join(dir, side, "project");
			fs.cpSync(path.join(PROJECTS_DIR, name), copy, { recursive: true });
			return copy;
		});
		fs.renameSync(
			path.join(byRogen, "default.project.json"),
			path.join(byRogen, "rogen.json")
		);
		return { dir, byRojo, byRogen };
	};

	describe("a build test of Rojo's", () => {
		it.each(projects)(
			"should build %s into each format as Rojo does, or fail as it does",
			(name) => {
				const { dir, byRojo, byRogen } = copies(name);
				const differing = FORMATS.filter((format) => {
					const expected = rojo(byRojo, [
						"build",
						"default.project.json",
						"-o",
						path.join(dir, `rojo.${format}`),
					]);
					const actual = rogen(byRogen, [
						"build",
						"-o",
						path.join(dir, `rogen.${format}`),
					]);
					if (expected.status !== 0) return actual.status === 0;
					return (
						actual.status !== 0 ||
						!fs
							.readFileSync(path.join(dir, `rogen.${format}`))
							.equals(
								fs.readFileSync(
									path.join(dir, `rojo.${format}`)
								)
							)
					);
				});

				expect(differing).toEqual([]);
			},
			60_000
		);

		it.each(projects)(
			"should write the sourcemap of %s as Rojo does, with each flag",
			(name) => {
				const { byRojo, byRogen } = copies(name);
				const differing = SOURCEMAP_FLAGS.filter((flags) => {
					const expected = rojo(byRojo, [
						"sourcemap",
						...flags,
						"default.project.json",
					]);
					const actual = rogen(byRogen, ["sourcemap", ...flags]);
					if (expected.status !== 0) return actual.status === 0;
					return (
						actual.status !== 0 ||
						actual.stdout.split(byRogen).join("") !==
							expected.stdout.split(byRojo).join("")
					);
				});

				expect(differing).toEqual([]);
			},
			60_000
		);
	});

	describe("a plain Rojo project and an edit made in Studio", () => {
		const PROJECT = {
			name: "game",
			tree: {
				$className: "DataModel",
				ReplicatedStorage: {
					$className: "ReplicatedStorage",
					Shared: { $path: "src/shared" },
				},
				ServerScriptService: {
					$className: "ServerScriptService",
					Server: { $path: "src/server" },
				},
				StarterPlayer: {
					$className: "StarterPlayer",
					StarterPlayerScripts: {
						$className: "StarterPlayerScripts",
						Client: { $path: "src/client" },
					},
				},
			},
		};
		const FILES: Record<string, string> = {
			"src/shared/Config.luau": "return {}",
			"src/shared/Gone.luau": "return {}",
			"src/shared/Util/init.luau": "return 1",
			"src/shared/Util/Math.luau": "return 2",
			"src/server/Main.server.luau": 'print("s")',
			"src/client/Main.client.luau": 'print("c")',
			"src/data/Data.json": '{"a":1}',
		};
		/** An edit no folder of the project can take, which neither tool writes. */
		const LEFT_ALONE = "add an instance outside the project";
		const SCENARIOS: Record<string, string> = {
			"edit a source":
				'game.ReplicatedStorage.Shared.Config.Source = "return {changed=true}"',
			"add a script":
				'local m = Instance.new("ModuleScript"); m.Name = "Added"; m.Source = "return 9"; m.Parent = game.ReplicatedStorage.Shared',
			"add a folder with a script":
				'local f = Instance.new("Folder"); f.Name = "Sub"; f.Parent = game.ReplicatedStorage.Shared; local m = Instance.new("ModuleScript"); m.Name = "Inner"; m.Source = "return 9"; m.Parent = f',
			"delete a script": "game.ReplicatedStorage.Shared.Gone:Destroy()",
			"add a child to an init script":
				'local m = Instance.new("ModuleScript"); m.Name = "Extra"; m.Source = "return 9"; m.Parent = game.ReplicatedStorage.Shared.Util',
			"add a server script":
				'local s = Instance.new("Script"); s.Name = "Second"; s.Source = "print(2)"; s.Parent = game.ServerScriptService.Server',
			"add a client script":
				'local s = Instance.new("LocalScript"); s.Name = "Second"; s.Source = "print(2)"; s.Parent = game.StarterPlayer.StarterPlayerScripts.Client',
			"set a property":
				"game.ServerScriptService.Server.Main.Disabled = true",
			"set an attribute":
				'game.ReplicatedStorage.Shared.Config:SetAttribute("k", 5)',
			"add a value":
				'local v = Instance.new("StringValue"); v.Name = "V"; v.Value = "hi"; v.Parent = game.ReplicatedStorage.Shared',
			"rename a script":
				'game.ReplicatedStorage.Shared.Config.Name = "Settings"',
			[LEFT_ALONE]:
				'local f = Instance.new("Folder"); f.Name = "Loose"; f.Parent = game.Workspace',
		};

		const write = (root: string) => {
			fs.writeFileSync(
				path.join(root, "default.project.json"),
				JSON.stringify(PROJECT)
			);
			for (const [file, text] of Object.entries(FILES)) {
				fs.mkdirSync(path.dirname(path.join(root, file)), {
					recursive: true,
				});
				fs.writeFileSync(path.join(root, file), text);
			}
		};

		/** The files under `root`, by relative path, with what is in them. */
		const snapshot = (root: string): Record<string, string> => {
			const seen: Record<string, string> = {};
			const walk = (dir: string) => {
				for (const entry of fs.readdirSync(dir, {
					withFileTypes: true,
				})) {
					const full = path.join(dir, entry.name);
					if (entry.isDirectory()) {
						seen[`${path.relative(root, full)}/`] = "";
						walk(full);
					} else
						seen[path.relative(root, full)] = fs.readFileSync(
							full,
							"utf8"
						);
				}
			};
			walk(root);
			return seen;
		};

		it.each(Object.entries(SCENARIOS))(
			"should sync back %s as Rojo does",
			(name, edit) => {
				const dir = fs.mkdtempSync(
					path.join(parent, `syncback-${name.replace(/ /g, "-")}-`)
				);
				const base = path.join(dir, "base");
				fs.mkdirSync(base);
				write(base);
				expect(
					rojo(base, [
						"build",
						"default.project.json",
						"-o",
						path.join(dir, "base.rbxl"),
					]).status
				).toBe(0);
				fs.writeFileSync(path.join(dir, "edits.luau"), edit);
				const lune = spawnSync(
					"lune",
					[
						"run",
						path.resolve("e2e/place-edit.luau"),
						path.join(dir, "base.rbxl"),
						path.join(dir, "edited.rbxl"),
						path.join(dir, "edits.luau"),
					],
					{ cwd: path.resolve("."), encoding: "utf8" }
				);
				expect(lune.status).toBe(0);

				const [byRojo, byRogen] = ["rojo", "rogen"].map((side) => {
					const copy = path.join(dir, side, "project");
					fs.mkdirSync(copy, { recursive: true });
					write(copy);
					return copy;
				});
				const input = path.join(dir, "edited.rbxl");
				const expected = rojo(
					byRojo,
					["syncback", "--input", input],
					"y\n"
				);
				const actual = rogen(byRogen, [
					"syncback",
					"--input",
					input,
					"-y",
				]);

				const untouched = path.join(dir, "untouched", "project");
				fs.mkdirSync(untouched, { recursive: true });
				write(untouched);

				expect(actual.status).toBe(expected.status);
				expect(snapshot(byRogen)).toEqual(snapshot(byRojo));
				expect(
					JSON.stringify(snapshot(byRojo)) !==
						JSON.stringify(snapshot(untouched))
				).toBe(name !== LEFT_ALONE);
			},
			60_000
		);
	});
});
