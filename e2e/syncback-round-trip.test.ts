import fs from "fs";
import os from "os";
import path from "path";
import { describeWithRojo } from "../src/domain/rojo/__tests__/rojo-cli.js";
import { bundleCli, invocation, run } from "./harness.js";
import { MatrixRun, PRELUDE, syncbackMatrix } from "./syncback-matrix.js";

/** Each run spawns about ten programs, side by side with the others. */
const RUN_TIMEOUT_MS = 120_000;

const runs = syncbackMatrix();

describeWithRojo("syncback round trip", () => {
	let bundle: ReturnType<typeof bundleCli>;
	let parent: string;

	beforeAll(() => {
		bundle = bundleCli();
		parent = fs.mkdtempSync(path.join(os.tmpdir(), "rogen-round-trip-"));
	});

	afterAll(() => {
		bundle.dispose();
		fs.rmSync(parent, { recursive: true, force: true });
	});

	/** Runs `command`, failing with what it printed when it fails. */
	const step = async (
		command: string,
		args: readonly string[],
		cwd: string
	) => {
		const result = await run(command, args, cwd);
		if (result.exitCode !== 0)
			throw new Error(
				`${command} ${args.join(" ")} exited ${result.exitCode}:\n${result.stdout}${result.stderr}`
			);
		return `${result.stdout}${result.stderr}`;
	};
	const rogen = (args: readonly string[], cwd: string) => {
		const [command, rest] = invocation(bundle.cli, args);
		return step(command, rest, cwd);
	};
	const lune = (script: string, args: readonly string[], cwd: string) =>
		step("lune", ["run", path.resolve("e2e", script), ...args], cwd);

	/** The project of `entry` in a folder of its own, written and built into a place, then edited as Studio would. */
	const editedPlace = async (entry: MatrixRun): Promise<string> => {
		const dir = fs.mkdtempSync(path.join(parent, "run-"));
		fs.writeFileSync(
			path.join(dir, "default.rogen.json"),
			JSON.stringify({
				name: "Game",
				tree: { $className: "DataModel" },
				sourcePaths: ["src"],
				routes: entry.routes,
			})
		);
		fs.copyFileSync(
			path.resolve("rokit.toml"),
			path.join(dir, "rokit.toml")
		);
		for (const file of entry.files) {
			const at = path.join(dir, "src", file);
			fs.mkdirSync(path.dirname(at), { recursive: true });
			const name = path.basename(file);
			fs.writeFileSync(
				at,
				name.endsWith(".meta.json")
					? '{"attributes":{"Kept":true}}\n'
					: name.startsWith("@")
						? ""
						: /\.(server|client)\.luau$/.test(name)
							? "print(0)\n"
							: "return {}\n"
			);
		}
		fs.writeFileSync(
			path.join(dir, "edit.luau"),
			`${PRELUDE}${entry.edit}\n`
		);
		await rogen(["write"], dir);
		await step(
			"rojo",
			["build", "default.project.json", "-o", "base.rbxl"],
			dir
		);
		await lune(
			"place-edit.luau",
			["base.rbxl", "edited.rbxl", "edit.luau"],
			dir
		);
		return dir;
	};

	/** Syncs `entry`'s edited place back, writes and rebuilds the project, and syncs back again as a dry run: what each syncback said, and the places as text. */
	const roundTrip = async (entry: MatrixRun) => {
		const dir = await editedPlace(entry);
		const said = await rogen(["syncback", "-i", "edited.rbxl", "-y"], dir);
		await rogen(["write"], dir);
		await step(
			"rojo",
			["build", "default.project.json", "-o", "rebuilt.rbxl"],
			dir
		);
		return {
			said,
			again: await rogen(
				["syncback", "-i", "edited.rbxl", "--dry-run"],
				dir
			),
			edited: await lune("place-dump.luau", ["edited.rbxl"], dir),
			rebuilt: await lune("place-dump.luau", ["rebuilt.rbxl"], dir),
		};
	};

	const named = (kind: MatrixRun["outcome"]["kind"]) =>
		runs
			.filter(({ outcome }) => outcome.kind === kind)
			.map((entry) => [entry.name, entry] as const);

	it.concurrent.each(named("roundTrip"))(
		"%s: the rebuilt place is the edited one, and a second syncback changes nothing",
		async (_, entry) => {
			const { said, again, edited, rebuilt } = await roundTrip(entry);

			expect(rebuilt).toBe(edited);
			expect(said).not.toContain("syncback.misplaced");
			expect(again).toContain("Syncback would change nothing.");
		},
		RUN_TIMEOUT_MS
	);

	it.concurrent.each(named("refused"))(
		"%s: syncback leaves the instance out with a warning, and a second syncback changes nothing",
		async (_, entry) => {
			const { said, again } = await roundTrip(entry);

			expect(said).toContain("syncback.unplaced");
			expect(said).not.toContain("syncback.misplaced");
			expect(again).toContain("Syncback would change nothing.");
		},
		RUN_TIMEOUT_MS
	);

	it.concurrent.each(named("rojoLimit"))(
		"%s: what Rojo drops stays dropped, and a second syncback changes nothing",
		async (_, entry) => {
			const { said, again } = await roundTrip(entry);

			expect(said).not.toContain("syncback.misplaced");
			expect(again).toContain("Syncback would change nothing.");
		},
		RUN_TIMEOUT_MS
	);
});
