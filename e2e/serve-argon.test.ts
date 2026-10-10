import fs from "fs";
import path from "path";
import { decode, encode } from "@msgpack/msgpack";
import {
	ARGON_TOOLCHAIN,
	describeWithArgon,
	eventually,
	writeProjectFile,
} from "./harness.js";
import { useServeProject } from "./serve-fixtures.js";

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

describeWithArgon("end to end serve with Argon", () => {
	const serve = useServeProject(38000, {
		"rokit.toml": ARGON_TOOLCHAIN,
	});

	it("should build, start the pinned Argon on the project file, and stop it on Ctrl+C", async () => {
		const serving = serve.start();

		await eventually(() => {
			expect(serving.output).toContain(
				`Serving default with Argon 2.0.29 at localhost:${serve.port}.`
			);
		}, 20_000);
		expect(await argonProject(serve.port)).toBe("Game");

		expect(await serving.stop()).toBe(0);
		expect(await argonProject(serve.port)).toBeUndefined();
	}, 40_000);

	it("should sync a source file added while it serves", async () => {
		const serving = serve.start();
		await eventually(() => {
			expect(serving.output).toContain("Serving default");
		}, 20_000);
		const client = new ArgonClient(serve.port);
		await client.subscribe();

		writeProjectFile(serve.dir, "src/B.luau");

		await eventually(async () => {
			expect(await client.added()).toContain("B");
		}, 20_000);
	}, 40_000);

	it("should show Argon's errors as its own lines, and nothing else Argon prints", async () => {
		const serving = serve.start();
		await eventually(() => {
			expect(serving.output).toContain("Serving default");
		}, 20_000);

		writeProjectFile(serve.dir, "src/Bad.model.json", "{ nope");
		writeProjectFile(serve.dir, "src/C.luau");

		await eventually(() => {
			expect(serving.output).toMatch(/Argon: .*src[\\/]Bad\.model\.json/);
		});
		expect(serving.output).not.toMatch(/INFO|source: |argon::|deleted/);
		expect(serving.output).not.toContain(serve.dir);
	}, 40_000);

	it("should keep Argon running as its own child when Argon's settings run it async", async () => {
		writeProjectFile(serve.dir, "argon.toml", "run_async = true\n");
		const serving = serve.start();

		await eventually(() => {
			expect(serving.output).toContain("Serving default");
		}, 20_000);
		expect(serving.output).not.toContain("stopped serving");

		expect(await serving.stop()).toBe(0);
		expect(await argonProject(serve.port)).toBeUndefined();
	}, 40_000);

	it("should serve with Argon when --tool asks for it, though Rojo is pinned too", async () => {
		writeProjectFile(
			serve.dir,
			"rokit.toml",
			fs.readFileSync(path.resolve("rokit.toml"), "utf8")
		);
		const serving = serve.start(["--tool", "argon", "--json"]);

		await eventually(() => {
			expect(serving.stdout).toContain('"serving"');
		}, 20_000);

		expect(
			JSON.parse(serving.stdout.trim().split("\n").at(-1)!).serving
		).toEqual(
			expect.objectContaining({
				tool: "argon",
				project: "Game",
				port: serve.port,
			})
		);
	}, 40_000);

	it("should exit with Argon's code when Argon stops on its own", async () => {
		const serving = serve.start(["--", "--no-such-flag"]);

		expect(await serving.exited).toBe(2);
		expect(serving.output).toContain(
			"Argon stopped serving default with exit code 2; see what it said above. (serve.serverExited)"
		);
	}, 40_000);
});
