import fs from "fs";
import os from "os";
import path from "path";
import { ProcessExit } from "../process-service.js";
import { NativeProcessService } from "../native-process-service.js";

const node = process.execPath;

describe("NativeProcessService", () => {
	let dir: string;
	let service: NativeProcessService;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "rogen-process-"));
		service = new NativeProcessService({
			...process.env,
			PATH: [path.dirname(node), dir].join(path.delimiter),
		});
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	describe("which", () => {
		it("should find a command on the PATH", async () => {
			expect(await service.which(path.basename(node, ".exe"))).toBe(node);
		});

		it("should answer undefined for a command that isn't on the PATH", async () => {
			expect(await service.which("rogen-no-such-tool")).toBeUndefined();
		});

		it("should skip a file that isn't executable", async () => {
			if (process.platform === "win32") return;
			fs.writeFileSync(path.join(dir, "plain"), "");

			expect(await service.which("plain")).toBeUndefined();
		});
	});

	describe("exec", () => {
		it("should capture what the process prints and its exit code", async () => {
			const result = await service.exec(
				node,
				[
					"-e",
					"console.log('out'); console.error('err'); process.exit(3)",
				],
				{ cwd: dir, timeout: 10_000 }
			);

			expect(result.unwrap()).toEqual({
				code: 3,
				stdout: "out\n",
				stderr: "err\n",
			});
		});

		it("should run in the given directory", async () => {
			const result = await service.exec(
				node,
				["-e", "console.log(process.cwd())"],
				{ cwd: dir, timeout: 10_000 }
			);

			expect(fs.realpathSync(result.unwrap().stdout.trim())).toBe(
				fs.realpathSync(dir)
			);
		});

		it("should fail when the file doesn't exist", async () => {
			const result = await service.exec(path.join(dir, "missing"), [], {
				cwd: dir,
				timeout: 10_000,
			});

			expect(result.isErr()).toBe(true);
		});

		it("should fail when the process outlives the timeout", async () => {
			const result = await service.exec(
				node,
				["-e", "setTimeout(() => {}, 60_000)"],
				{ cwd: dir, timeout: 200 }
			);

			expect(result.isErr()).toBe(true);
		});
	});

	describe("spawn", () => {
		const exitOf = (child: ReturnType<NativeProcessService["spawn"]>) =>
			new Promise<ProcessExit>((resolve) => child.onDidExit(resolve));

		it("should report the exit code of a process that ends", async () => {
			const child = service.spawn(node, ["-e", "process.exit(4)"], {
				cwd: dir,
				output: "stderr",
			});

			expect(await exitOf(child)).toEqual({ code: 4, signal: null });
			child[Symbol.dispose]();
		});

		it("should end a running process on terminate", async () => {
			const child = service.spawn(
				node,
				["-e", "setTimeout(() => {}, 60_000)"],
				{ cwd: dir, output: "stderr" }
			);
			const exited = exitOf(child);

			const exit = await child.terminate();

			expect(exit.code === 0 || exit.signal !== null).toBe(true);
			expect(await exited).toEqual(exit);
			expect(await child.terminate()).toEqual(exit);
			child[Symbol.dispose]();
		});

		it("should report a file that can't start as an exit with an error", async () => {
			const child = service.spawn(path.join(dir, "missing"), [], {
				cwd: dir,
				output: "stderr",
			});

			const exit = await exitOf(child);

			expect(exit.code).toBeNull();
			expect(exit.error?.message).toContain("ENOENT");
			child[Symbol.dispose]();
		});

		it("should keep the process's output off stdout when told to", async () => {
			const result = await service.exec(
				node,
				[
					"--import",
					"tsx",
					"-e",
					[
						`import { NativeProcessService } from ${JSON.stringify(
							path.resolve(
								"src/platform/process/native-process-service.ts"
							)
						)};`,
						"const child = new NativeProcessService().spawn(process.execPath, ['-e', 'console.log(\"child\")'], { cwd: process.cwd(), output: 'stderr' });",
						"child.onDidExit(() => console.log('parent'));",
					].join("\n"),
				],
				{ cwd: process.cwd(), timeout: 20_000 }
			);

			const output = result.unwrap();
			expect(output.stdout).toBe("parent\n");
			expect(output.stderr).toBe("child\n");
		}, 30_000);
	});
});
