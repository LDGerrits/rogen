import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { CoreToolchainService } from "../../toolchain/core-toolchain-service.js";
import { SyncServer } from "../sync-server.js";
import { ServerFinder } from "../server-finder.js";

const ROJO_VERSION = { code: 0, stdout: "Rojo 7.7.1\n", stderr: "" };

describe("ServerFinder", () => {
	let fs: MemoryFileSystemService;
	let processes: MockProcessService;
	let finder: ServerFinder;

	const find = () =>
		finder.find("/repo/game", "/repo/game/default.rogen.json");

	const diagnosticOf = async () => {
		const result = await find();
		if (result.isOk()) throw new Error("expected a failure");
		return result.error.diagnostics[0];
	};

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo/game");
		processes = new MockProcessService();
		finder = new ServerFinder(new CoreToolchainService(fs), processes);
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
		});
		expect(processes.execs).toEqual([
			{ file: "/bin/rojo7", args: ["--version"], cwd: "/repo/game" },
		]);
	});

	it("should let the caller end the version check", async () => {
		processes.installed.set("rojo", "/usr/bin/rojo");
		processes.outputs.set("/usr/bin/rojo", ROJO_VERSION);
		const controller = new AbortController();

		await finder.find("/repo/game", "/repo/game", controller.signal);

		expect(processes.execs[0].signal).toBe(controller.signal);
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
			"No Rojo to serve with: none is pinned in a toolchain file here or above, or on the PATH. Run 'rokit add rojo-rbx/rojo', then 'rogen plugin install' to install its Studio plugin."
		);
		expect(diagnostic.fixes).toEqual([
			{ run: { command: "rokit add rojo-rbx/rojo", cwd: "/repo/game" } },
			{ run: { command: "rogen plugin install", cwd: "/repo/game" } },
		]);
	});

	it("should find a Rojo pinned in a folder above", async () => {
		await fs.writeFile(
			"/repo/aftman.toml",
			'[tools]\nrojo = "rojo-rbx/rojo@7.7.1"\n'
		);
		processes.installed.set("rojo", "/bin/rojo");
		processes.outputs.set("/bin/rojo", ROJO_VERSION);

		expect((await find()).unwrap().server).toBe(SyncServer.ROJO);
	});

	it("should say that rogen serve only starts Rojo when only Argon is pinned", async () => {
		await fs.writeFile(
			"/repo/game/rokit.toml",
			'[tools]\nargon = "argon-rbx/argon@2.0.24"\n'
		);
		processes.installed.set("argon", "/bin/argon");

		const diagnostic = await diagnosticOf();

		expect(diagnostic.code).toBe("serve.noServer");
		expect(diagnostic.message).toContain(
			"Argon is pinned, but rogen serve only starts Rojo: run 'rogen build --watch' to keep the project files current, and 'argon serve' to serve them."
		);
	});

	it("should say nothing of Argon when it is not pinned", async () => {
		expect((await diagnosticOf()).message).not.toContain("Argon");
	});

	it("should say to pin the server by hand in a Foreman file", async () => {
		await fs.writeFile("/repo/foreman.toml", "[tools]\n");

		const diagnostic = await diagnosticOf();

		expect(diagnostic.message).toBe(
			"No Rojo to serve with: none is pinned in a toolchain file here or above, or on the PATH. Pin rojo-rbx/rojo in foreman.toml, install it, then run 'rogen plugin install' to install its Studio plugin."
		);
		expect(diagnostic.fixes).toEqual([
			{ run: { command: "rogen plugin install", cwd: "/repo/game" } },
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
