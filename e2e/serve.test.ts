import { decode, encode } from "@msgpack/msgpack";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { describeWithRojo } from "../src/domain/rojo/__tests__/rojo-cli.js";
import {
	ARGON_TOOLCHAIN,
	WatchSession,
	bundleCli,
	createProject,
	describeWithArgon,
	eventually,
	writeProjectFile,
} from "./harness.js";

const config = (extra: Record<string, unknown> = {}) =>
	JSON.stringify({
		rootDirs: ["src"],
		routes: { server: "ServerScriptService", "*": "ReplicatedStorage" },
		template: "template.project.json",
		...extra,
	});

const template = (port: number, name = "Game") =>
	JSON.stringify({
		name,
		servePort: port,
		tree: { $className: "DataModel" },
	});

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

async function argonProject(port: number): Promise<string | undefined> {
	try {
		const response = await fetch(`http://127.0.0.1:${port}/details`, {
			signal: AbortSignal.timeout(1_000),
		});
		const details = decode(
			new Uint8Array(await response.arrayBuffer())
		) as {
			name: string;
		};
		return details.name;
	} catch {
		return undefined;
	}
}

interface ArgonInstance {
	readonly name: string;
	readonly children?: readonly ArgonInstance[];
}

const namesIn = (instances: readonly ArgonInstance[]): string[] =>
	instances.flatMap((instance) => [
		instance.name,
		...namesIn(instance.children ?? []),
	]);

/** What Argon's Studio plugin sees: it subscribes, then reads each sync. */
class ArgonClient {
	private readonly id = Math.floor(Math.random() * 1_000_000);

	constructor(private readonly port: number) {}

	async subscribe(): Promise<void> {
		const response = await this.post("/subscribe", {
			clientId: this.id,
			name: "e2e",
		});
		if (!response.ok)
			throw new Error(`Argon refused the client: ${response.status}`);
	}

	/** The names of the instances the next sync adds. */
	async added(): Promise<string[]> {
		const response = await this.post(
			"/read",
			{ clientId: this.id },
			AbortSignal.timeout(10_000)
		);
		const message = decode(
			new Uint8Array(await response.arrayBuffer())
		) as {
			SyncChanges?: { additions: ArgonInstance[] };
		};
		return namesIn(message.SyncChanges?.additions ?? []);
	}

	private post(route: string, body: unknown, signal?: AbortSignal) {
		return fetch(`http://127.0.0.1:${this.port}${route}`, {
			method: "POST",
			headers: { "content-type": "application/msgpack" },
			body: encode(body),
			signal,
		});
	}
}

describeWithRojo("end to end serve", () => {
	let bundle: ReturnType<typeof bundleCli>;
	let project: ReturnType<typeof createProject>;
	let sessions: WatchSession[];
	let port: number;

	const start = (args: readonly string[] = []) => {
		const session = new WatchSession(
			bundle.cli,
			project.dir,
			args,
			project.dir,
			"serve"
		);
		sessions.push(session);
		return session;
	};

	beforeAll(() => {
		bundle = bundleCli();
	});

	afterAll(() => {
		bundle.dispose();
	});

	beforeEach(() => {
		port = 35000 + Math.floor(Math.random() * 2000);
		project = createProject({
			"default.rogen.json": config(),
			"template.project.json": template(port),
			"src/A.server.luau": "",
		});
		sessions = [];
	});

	afterEach(async () => {
		await Promise.all(sessions.map((session) => session.stop()));
		project.dispose();
	});

	it("should build, start the pinned Rojo on the project file, and stop it on Ctrl+C", async () => {
		const serving = start();

		await eventually(() => {
			expect(serving.output).toContain(
				`Serving default with Rojo 7.7.1 at 127.0.0.1:${port}.`
			);
		}, 20_000);
		expect(await rojoProject(port)).toBe("Game");

		expect(await serving.stop()).toBe(0);
		expect(await rojoProject(port)).toBeUndefined();
	}, 40_000);

	it("should keep building while it serves", async () => {
		const serving = start();
		await eventually(() => {
			expect(serving.output).toContain("Serving default");
		}, 20_000);

		writeProjectFile(project.dir, "src/B.luau");

		await eventually(() => {
			expect(serving.output).toContain("1 file changed");
		});
	}, 40_000);

	it("should show Rojo's errors as its own lines, and nothing else Rojo prints", async () => {
		const serving = start();
		await eventually(() => {
			expect(serving.output).toContain("Serving default");
		}, 20_000);

		writeProjectFile(project.dir, "src/Bad.model.json", "{ nope");

		await eventually(() => {
			expect(serving.output).toMatch(/Rojo: .*src[\\/]Bad\.model\.json/);
		});
		expect(serving.output).not.toContain("Caused by");
		expect(serving.output).not.toContain("librojo");
		expect(serving.output).not.toContain(project.dir);
	}, 40_000);

	it("should start a server for a place added while it serves, and stop it when the place is removed", async () => {
		const serving = start();
		await eventually(() => {
			expect(serving.output).toContain("Serving default");
		}, 20_000);

		writeProjectFile(
			project.dir,
			"templates/lobby.project.json",
			template(port + 1, "Lobby")
		);
		writeProjectFile(
			project.dir,
			"lobby.rogen.json",
			config({ template: "templates/lobby.project.json" })
		);

		await eventually(() => {
			expect(serving.output).toContain(
				`Serving lobby with Rojo 7.7.1 at 127.0.0.1:${port + 1}.`
			);
		}, 20_000);
		expect(await rojoProject(port + 1)).toBe("Lobby");

		fs.rmSync(path.join(project.dir, "lobby.rogen.json"));

		await eventually(async () => {
			expect(await rojoProject(port + 1)).toBeUndefined();
		}, 20_000);
		expect(serving.output).toContain(
			"Stopped serving lobby: its config is gone."
		);
		expect(await rojoProject(port)).toBe("Game");
	}, 60_000);

	it("should restart the server where its template moves it", async () => {
		const serving = start();
		await eventually(() => {
			expect(serving.output).toContain("Serving default");
		}, 20_000);

		writeProjectFile(
			project.dir,
			"template.project.json",
			template(port + 2)
		);

		await eventually(async () => {
			expect(await rojoProject(port + 2)).toBe("Game");
		}, 20_000);
		expect(await rojoProject(port)).toBeUndefined();
		expect(serving.output).toContain(
			`Stopped serving default at 127.0.0.1:${port}: its template moved it.`
		);
		expect(await serving.stop()).toBe(0);
	}, 60_000);

	it("should print only JSON lines on stdout, the build and then the server", async () => {
		const serving = start(["--json"]);

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
				port,
			})
		);
		expect(serving.output).not.toContain("Rojo server listening");
	}, 40_000);

	it("should exit 0 at once when the project is already served", async () => {
		const first = start();
		await eventually(() => {
			expect(first.output).toContain("Serving default");
		}, 20_000);

		const second = start(["--json"]);

		expect(await second.exited).toBe(0);
		expect(JSON.parse(second.stdout.trim()).serving).toEqual(
			expect.objectContaining({ port, alreadyRunning: true })
		);
	}, 40_000);

	it("should refuse a server that another checkout of the project started", async () => {
		const first = start();
		await eventually(() => {
			expect(first.output).toContain("Serving default");
		}, 20_000);
		const checkout = createProject({
			"default.rogen.json": config(),
			"template.project.json": template(port),
			"src/A.server.luau": "",
		});
		try {
			const second = new WatchSession(
				bundle.cli,
				checkout.dir,
				[],
				checkout.dir,
				"serve"
			);
			sessions.push(second);

			expect(await second.exited).toBe(1);
			expect(second.output).toContain(
				`Port ${port} is taken by Rojo serving Game from ${project.dir}`
			);
		} finally {
			checkout.dispose();
		}
	}, 40_000);

	it("should refuse a port another project's server holds", async () => {
		const other = createProject({
			"other.project.json": template(port, "Other"),
		});
		const rojo = spawn("rojo", ["serve", "other.project.json"], {
			cwd: other.dir,
			stdio: "ignore",
		});
		try {
			await eventually(async () => {
				expect(await rojoProject(port)).toBe("Other");
			}, 20_000);

			const serving = start();

			expect(await serving.exited).toBe(1);
			expect(serving.output).toContain(
				`Port ${port} is taken by Rojo serving Other, so default can't be served there.`
			);
		} finally {
			rojo.kill("SIGINT");
			other.dispose();
		}
	}, 40_000);

	it("should exit with Rojo's code when Rojo stops on its own", async () => {
		const serving = start(["--", "--no-such-flag"]);

		expect(await serving.exited).toBe(2);
		expect(serving.output).toContain(
			"Rojo stopped serving default with exit code 2; see what it said above. (serve.serverExited)"
		);
		expect(serving.output).toContain(
			"Rojo: Found argument '--no-such-flag'"
		);
	}, 40_000);
});

describeWithArgon("end to end serve with Argon", () => {
	let bundle: ReturnType<typeof bundleCli>;
	let project: ReturnType<typeof createProject>;
	let sessions: WatchSession[];
	let port: number;

	const start = (args: readonly string[] = []) => {
		const session = new WatchSession(
			bundle.cli,
			project.dir,
			args,
			project.dir,
			"serve"
		);
		sessions.push(session);
		return session;
	};

	beforeAll(() => {
		bundle = bundleCli();
	});

	afterAll(() => {
		bundle.dispose();
	});

	beforeEach(() => {
		port = 37000 + Math.floor(Math.random() * 2000);
		project = createProject({
			"rokit.toml": ARGON_TOOLCHAIN,
			"default.rogen.json": config(),
			"template.project.json": template(port),
			"src/A.server.luau": "",
		});
		sessions = [];
	});

	afterEach(async () => {
		await Promise.all(sessions.map((session) => session.stop()));
		project.dispose();
	});

	it("should build, start the pinned Argon on the project file, and stop it on Ctrl+C", async () => {
		const serving = start();

		await eventually(() => {
			expect(serving.output).toContain(
				`Serving default with Argon 2.0.29 at localhost:${port}.`
			);
		}, 20_000);
		expect(await argonProject(port)).toBe("Game");

		expect(await serving.stop()).toBe(0);
		expect(await argonProject(port)).toBeUndefined();
	}, 40_000);

	it("should sync a source file added while it serves", async () => {
		const serving = start();
		await eventually(() => {
			expect(serving.output).toContain("Serving default");
		}, 20_000);
		const client = new ArgonClient(port);
		await client.subscribe();

		writeProjectFile(project.dir, "src/B.luau");

		await eventually(async () => {
			expect(await client.added()).toContain("B");
		}, 20_000);
	}, 40_000);

	it("should show Argon's errors as its own lines, and nothing else Argon prints", async () => {
		const serving = start();
		await eventually(() => {
			expect(serving.output).toContain("Serving default");
		}, 20_000);

		writeProjectFile(project.dir, "src/Bad.model.json", "{ nope");
		writeProjectFile(project.dir, "src/C.luau");

		await eventually(() => {
			expect(serving.output).toMatch(/Argon: .*src[\\/]Bad\.model\.json/);
		});
		expect(serving.output).not.toMatch(/INFO|source: |argon::|deleted/);
		expect(serving.output).not.toContain(project.dir);
	}, 40_000);

	it("should keep Argon running as its own child when Argon's settings run it async", async () => {
		writeProjectFile(project.dir, "argon.toml", "run_async = true\n");
		const serving = start();

		await eventually(() => {
			expect(serving.output).toContain("Serving default");
		}, 20_000);
		expect(serving.output).not.toContain("stopped serving");

		expect(await serving.stop()).toBe(0);
		expect(await argonProject(port)).toBeUndefined();
	}, 40_000);

	it("should serve with Argon when --tool asks for it, though Rojo is pinned too", async () => {
		writeProjectFile(
			project.dir,
			"rokit.toml",
			fs.readFileSync(path.resolve("rokit.toml"), "utf8")
		);
		const serving = start(["--tool", "argon", "--json"]);

		await eventually(() => {
			expect(serving.stdout).toContain('"serving"');
		}, 20_000);

		expect(
			JSON.parse(serving.stdout.trim().split("\n").at(-1)!).serving
		).toEqual(
			expect.objectContaining({ tool: "argon", project: "Game", port })
		);
	}, 40_000);

	it("should exit with Argon's code when Argon stops on its own", async () => {
		const serving = start(["--", "--no-such-flag"]);

		expect(await serving.exited).toBe(2);
		expect(serving.output).toContain(
			"Argon stopped serving default with exit code 2; see what it said above. (serve.serverExited)"
		);
	}, 40_000);
});
