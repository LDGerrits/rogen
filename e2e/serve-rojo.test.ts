import { spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { decode } from "@msgpack/msgpack";
import { describeWithRojo } from "../src/domain/rojo/__tests__/rojo-cli.js";
import {
	createProject,
	eventually,
	invocation,
	writeProjectFile,
} from "./harness.js";
import {
	config,
	projectFiles,
	template,
	useServeProject,
} from "./serve-fixtures.js";

async function rojoProject(port: number): Promise<string | undefined> {
	try {
		const response = await fetch(`http://127.0.0.1:${port}/api/rojo`, {
			signal: AbortSignal.timeout(1_000),
		});
		const info = decode(new Uint8Array(await response.arrayBuffer())) as {
			projectName: string;
		};
		return info.projectName;
	} catch {
		return undefined;
	}
}

describeWithRojo("end to end serve", () => {
	const serve = useServeProject(35000);

	it("should build, start the pinned Rojo on the project file, and stop it on Ctrl+C", async () => {
		const serving = serve.start();

		await eventually(() => {
			expect(serving.output).toContain(
				`Serving default with Rojo 7.7.1 at 127.0.0.1:${serve.port}.`
			);
		}, 20_000);
		expect(await rojoProject(serve.port)).toBe("Game");

		expect(await serving.stop()).toBe(0);
		expect(await rojoProject(serve.port)).toBeUndefined();
	}, 40_000);

	it("should keep building while it serves", async () => {
		const serving = serve.start();
		await eventually(() => {
			expect(serving.output).toContain("Serving default");
		}, 20_000);

		writeProjectFile(serve.dir, "src/B.luau");

		await eventually(() => {
			expect(serving.output).toContain("1 file changed");
		});
	}, 40_000);

	it("should show Rojo's errors as its own lines, and nothing else Rojo prints", async () => {
		const serving = serve.start();
		await eventually(() => {
			expect(serving.output).toContain("Serving default");
		}, 20_000);

		writeProjectFile(serve.dir, "src/Bad.model.json", "{ nope");

		await eventually(() => {
			expect(serving.output).toMatch(/Rojo: .*src[\\/]Bad\.model\.json/);
		});
		expect(serving.output).not.toContain("Caused by");
		expect(serving.output).not.toContain("librojo");
		expect(serving.output).not.toContain(serve.dir);
	}, 40_000);

	it("should start a server for a place added while it serves, and stop it when the place is removed", async () => {
		const serving = serve.start();
		await eventually(() => {
			expect(serving.output).toContain("Serving default");
		}, 20_000);

		writeProjectFile(
			serve.dir,
			"templates/lobby.project.json",
			template(serve.port + 1, "Lobby")
		);
		writeProjectFile(
			serve.dir,
			"lobby.rogen.json",
			config({ template: "templates/lobby.project.json" })
		);

		await eventually(() => {
			expect(serving.output).toContain(
				`Serving lobby with Rojo 7.7.1 at 127.0.0.1:${serve.port + 1}.`
			);
		}, 20_000);
		expect(await rojoProject(serve.port + 1)).toBe("Lobby");

		fs.rmSync(path.join(serve.dir, "lobby.rogen.json"));

		await eventually(() => {
			expect(serving.output).toContain(
				"Stopped serving lobby: its config is gone."
			);
		}, 20_000);
		expect(await rojoProject(serve.port + 1)).toBeUndefined();
		expect(await rojoProject(serve.port)).toBe("Game");
	}, 60_000);

	it("should serve every place init adds, each under its own name and port", async () => {
		const init = (name: string) => {
			const [command, args] = invocation(serve.cli, ["init", name, "-y"]);
			return spawnSync(command, args, {
				cwd: serve.dir,
				encoding: "utf8",
			}).status;
		};
		expect(init("lobby")).toBe(0);
		expect(init("arena")).toBe(0);
		const templateOf = (place: string) =>
			path.join(serve.dir, "places", place, "template.project.json");
		const ports = ["lobby", "arena"].map(
			(place) =>
				JSON.parse(fs.readFileSync(templateOf(place), "utf8")).servePort
		);
		expect(ports).toEqual([34873, 34874]);
		for (const [index, place] of ["lobby", "arena"].entries()) {
			const written = JSON.parse(
				fs.readFileSync(templateOf(place), "utf8")
			);
			fs.writeFileSync(
				templateOf(place),
				JSON.stringify({
					...written,
					servePort: serve.port + 1 + index,
				})
			);
		}

		const serving = serve.start();

		await eventually(() => {
			expect(serving.output).toContain(
				`Serving lobby with Rojo 7.7.1 at 127.0.0.1:${serve.port + 1}.`
			);
			expect(serving.output).toContain(
				`Serving arena with Rojo 7.7.1 at 127.0.0.1:${serve.port + 2}.`
			);
		}, 30_000);
		expect(await rojoProject(serve.port + 1)).toBe("Lobby");
		expect(await rojoProject(serve.port + 2)).toBe("Arena");
		expect(await rojoProject(serve.port)).toBeUndefined();
		expect(await serving.stop()).toBe(0);
	}, 60_000);

	it("should restart the server where its template moves it", async () => {
		const serving = serve.start();
		await eventually(() => {
			expect(serving.output).toContain("Serving default");
		}, 20_000);

		writeProjectFile(
			serve.dir,
			"template.project.json",
			template(serve.port + 2)
		);

		await eventually(async () => {
			expect(await rojoProject(serve.port + 2)).toBe("Game");
		}, 20_000);
		expect(await rojoProject(serve.port)).toBeUndefined();
		expect(serving.output).toContain(
			`Stopped serving default at 127.0.0.1:${serve.port}: its template moved it.`
		);
		expect(await serving.stop()).toBe(0);
	}, 60_000);

	it("should print only JSON lines on stdout, the build and then the server", async () => {
		const serving = serve.start(["--json"]);

		await eventually(() => {
			expect(serving.stdout).toContain('"serving"');
		}, 20_000);

		const lines = serving.stdout
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(lines.map((line) => Object.keys(line)[0])).toEqual([
			"build",
			"serving",
		]);
		expect(lines[1].serving).toEqual(
			expect.objectContaining({
				config: "default",
				tool: "rojo",
				version: "7.7.1",
				project: "Game",
				port: serve.port,
			})
		);
		expect(serving.output).not.toContain("Rojo server listening");
	}, 40_000);

	it("should exit 0 at once when the project is already served", async () => {
		const first = serve.start();
		await eventually(() => {
			expect(first.output).toContain("Serving default");
		}, 20_000);

		const second = serve.start(["--json"]);

		expect(await second.exited).toBe(0);
		expect(JSON.parse(second.stdout.trim()).serving).toEqual(
			expect.objectContaining({ port: serve.port, alreadyRunning: true })
		);
	}, 40_000);

	it("should refuse a server that another checkout of the project started", async () => {
		const first = serve.start();
		await eventually(() => {
			expect(first.output).toContain("Serving default");
		}, 20_000);
		const checkout = createProject(projectFiles(serve.port));
		try {
			const second = serve.start([], checkout.dir);

			expect(await second.exited).toBe(1);
			expect(second.output).toContain(
				`Port ${serve.port} is taken by Rojo serving Game from ${serve.dir}`
			);
		} finally {
			checkout.dispose();
		}
	}, 40_000);

	it("should refuse a port another project's server holds", async () => {
		const other = createProject({
			"other.project.json": template(serve.port, "Other"),
		});
		const rojo = spawn("rojo", ["serve", "other.project.json"], {
			cwd: other.dir,
			stdio: "ignore",
		});
		try {
			await eventually(async () => {
				expect(await rojoProject(serve.port)).toBe("Other");
			}, 20_000);

			const serving = serve.start();

			expect(await serving.exited).toBe(1);
			expect(serving.output).toContain(
				`Port ${serve.port} is taken by Rojo serving Other, so default can't be served there.`
			);
		} finally {
			rojo.kill("SIGINT");
			other.dispose();
		}
	}, 40_000);

	it("should exit with Rojo's code when Rojo stops on its own", async () => {
		const serving = serve.start(["--", "--no-such-flag"]);

		expect(await serving.exited).toBe(2);
		expect(serving.output).toContain(
			"Rojo stopped serving default with exit code 2; see what it said above. (serve.serverExited)"
		);
		expect(serving.output).toContain(
			"Rojo: Found argument '--no-such-flag'"
		);
	}, 40_000);
});
