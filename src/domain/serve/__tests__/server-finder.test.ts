import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { SyncServer } from "../serve.js";
import { ServerFinder } from "../server-finder.js";

const ROJO_VERSION = { code: 0, stdout: "Rojo 7.7.1\n", stderr: "" };
const ARGON_VERSION = { code: 0, stdout: "argon 2.0.24\n", stderr: "" };

describe("ServerFinder", () => {
	let fs: MemoryFileSystemService;
	let processes: MockProcessService;
	let finder: ServerFinder;

	const find = (wanted?: SyncServer) =>
		finder.find("/repo/game", wanted, "/repo/game/default.rogen.json");

	const diagnosticOf = async (wanted?: SyncServer) => {
		const result = await find(wanted);
		if (result.isOk()) throw new Error("expected a failure");
		return result.error.diagnostics[0];
	};

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo/game");
		processes = new MockProcessService();
		finder = new ServerFinder(fs, processes);
	});

	it("should run the server the project pins, by the name it pins it as", async () => {
		await fs.writeFile(
			"/repo/game/rokit.toml",
			'[tools]\nrojo7 = "rojo-rbx/rojo@7.7.1"\n'
		);
		processes.installed.set("rojo7", "/bin/rojo7");
		processes.outputs.set("/bin/rojo7", ROJO_VERSION);

		const tool = (await find()).unwrap();

		expect(tool).toEqual({
			server: SyncServer.ROJO,
			file: "/bin/rojo7",
			version: "7.7.1",
			passedOver: undefined,
		});
		expect(processes.execs).toEqual([
			{ file: "/bin/rojo7", args: ["--version"], cwd: "/repo/game" },
		]);
	});

	it("should find a pin in a folder above", async () => {
		await fs.writeFile(
			"/repo/aftman.toml",
			'[tools]\nargon = "argon-rbx/argon@2.0.24"\n'
		);
		processes.installed.set("argon", "/bin/argon");
		processes.outputs.set("/bin/argon", ARGON_VERSION);

		expect((await find()).unwrap().server).toBe(SyncServer.ARGON);
	});

	it("should pick Rojo when both are pinned, and say which it passed over", async () => {
		await fs.writeFile(
			"/repo/game/rokit.toml",
			'[tools]\nargon = "argon-rbx/argon@2.0.24"\nrojo = "rojo-rbx/rojo@7.7.1"\n'
		);
		processes.installed.set("rojo", "/bin/rojo");
		processes.installed.set("argon", "/bin/argon");
		processes.outputs.set("/bin/rojo", ROJO_VERSION);

		const tool = (await find()).unwrap();

		expect(tool.server).toBe(SyncServer.ROJO);
		expect(tool.passedOver).toBe(SyncServer.ARGON);
	});

	it("should say nothing of the other server when both are only on the PATH", async () => {
		processes.installed.set("rojo", "/usr/bin/rojo");
		processes.installed.set("argon", "/usr/bin/argon");
		processes.outputs.set("/usr/bin/rojo", ROJO_VERSION);

		const tool = (await find()).unwrap();

		expect(tool.server).toBe(SyncServer.ROJO);
		expect(tool.passedOver).toBeUndefined();
	});

	it("should pick the server asked for", async () => {
		await fs.writeFile(
			"/repo/game/rokit.toml",
			'[tools]\nrojo = "rojo-rbx/rojo@7.7.1"\nargon = "argon-rbx/argon@2.0.24"\n'
		);
		processes.installed.set("rojo", "/bin/rojo");
		processes.installed.set("argon", "/bin/argon");
		processes.outputs.set("/bin/argon", ARGON_VERSION);

		const tool = (await find(SyncServer.ARGON)).unwrap();

		expect(tool.server).toBe(SyncServer.ARGON);
		expect(tool.passedOver).toBeUndefined();
	});

	it("should fall back to the PATH when nothing is pinned", async () => {
		processes.installed.set("argon", "/usr/bin/argon");
		processes.outputs.set("/usr/bin/argon", ARGON_VERSION);

		expect((await find()).unwrap()).toEqual({
			server: SyncServer.ARGON,
			file: "/usr/bin/argon",
			version: "2.0.24",
			passedOver: undefined,
		});
	});

	it("should say to install a server that is pinned but not installed", async () => {
		await fs.writeFile(
			"/repo/rokit.toml",
			'[tools]\nrojo = "rojo-rbx/rojo@7.7.1"\n'
		);
		processes.installed.set("argon", "/usr/bin/argon");

		const diagnostic = await diagnosticOf();

		expect(diagnostic.code).toBe("serve.notInstalled");
		expect(diagnostic.resource).toBe("/repo/rokit.toml");
		expect(diagnostic.message).toBe(
			"rokit.toml pins Rojo as rojo, but it isn't installed. Run 'rokit install'."
		);
		expect(diagnostic.fixes).toEqual([
			{ run: { command: "rokit install", cwd: "/repo" } },
		]);
	});

	it("should say how to add Rojo and its plugin when there is no server at all", async () => {
		const diagnostic = await diagnosticOf();

		expect(diagnostic.code).toBe("serve.noServer");
		expect(diagnostic.resource).toBe("/repo/game/default.rogen.json");
		expect(diagnostic.message).toBe(
			"No Rojo or Argon to serve with: none is pinned in a toolchain file here or above, or on the PATH. Run 'rokit add rojo-rbx/rojo', then 'rojo plugin install' to install its Studio plugin."
		);
		expect(diagnostic.fixes).toEqual([
			{ run: { command: "rokit add rojo-rbx/rojo", cwd: "/repo/game" } },
			{ run: { command: "rojo plugin install", cwd: "/repo/game" } },
		]);
	});

	it("should add the server asked for with the project's own manager", async () => {
		await fs.writeFile("/repo/aftman.toml", "[tools]\n");

		const diagnostic = await diagnosticOf(SyncServer.ARGON);

		expect(diagnostic.message).toBe(
			"No Argon to serve with: none is pinned in a toolchain file here or above, or on the PATH. Run 'aftman add argon-rbx/argon', then 'argon plugin install' to install its Studio plugin."
		);
		expect(diagnostic.fixes?.[0]).toEqual({
			run: { command: "aftman add argon-rbx/argon", cwd: "/repo" },
		});
	});

	it("should say to pin the server by hand in a Foreman file", async () => {
		await fs.writeFile("/repo/foreman.toml", "[tools]\n");

		const diagnostic = await diagnosticOf();

		expect(diagnostic.message).toBe(
			"No Rojo or Argon to serve with: none is pinned in a toolchain file here or above, or on the PATH. Pin rojo-rbx/rojo in foreman.toml, install it, then run 'rojo plugin install' to install its Studio plugin."
		);
		expect(diagnostic.fixes).toEqual([
			{ run: { command: "rojo plugin install", cwd: "/repo/game" } },
		]);
	});

	it("should report a server that fails to run, with what it printed", async () => {
		processes.installed.set("rojo", "/home/me/.rokit/bin/rojo");
		processes.outputs.set("/home/me/.rokit/bin/rojo", {
			code: 1,
			stdout: "",
			stderr: "\u001b[31mERROR\u001b[0m Failed to find tool 'rojo' in any project manifest file.\nAdd the tool to a project using 'rokit add'.\n",
		});

		const diagnostic = await diagnosticOf();

		expect(diagnostic.code).toBe("serve.serverFailed");
		expect(diagnostic.message).toBe(
			"'rojo --version' failed, so Rojo can't start: ERROR Failed to find tool 'rojo' in any project manifest file. If Rojo isn't pinned yet, run 'rokit add rojo-rbx/rojo'."
		);
		expect(diagnostic.fixes).toEqual([
			{ run: { command: "rokit add rojo-rbx/rojo", cwd: "/repo/game" } },
		]);
	});

	it("should offer no pin for a pinned server that fails to run", async () => {
		await fs.writeFile(
			"/repo/game/rokit.toml",
			'[tools]\nrojo = "rojo-rbx/rojo@7.7.1"\n'
		);
		processes.installed.set("rojo", "/bin/rojo");

		const diagnostic = await diagnosticOf();

		expect(diagnostic.resource).toBe("/repo/game/rokit.toml");
		expect(diagnostic.message).toBe(
			"'rojo --version' failed, so Rojo can't start: spawn /bin/rojo ENOENT."
		);
		expect(diagnostic.fixes).toBeUndefined();
	});
});
