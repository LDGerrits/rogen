import path from "path";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { gitOf } from "./init-of.js";

describe("GitRepository", () => {
	const root = path.resolve("/repo");
	const withGit = () =>
		new MockProcessService(new Map([["git", "/bin/git"]]));

	it("should fail to init when git is not installed", async () => {
		const processes = new MockProcessService();

		const made = await gitOf(processes, new MemoryFileSystemService()).init(
			root
		);

		expect(made.isErr() && made.error.message).toBe(
			"git is not installed."
		);
		expect(processes.execs).toEqual([]);
	});

	it("should fail to init when git can't run", async () => {
		const made = await gitOf(withGit(), new MemoryFileSystemService()).init(
			root
		);

		expect(made.isErr() && made.error.message).toBe(
			"spawn /bin/git ENOENT"
		);
	});

	it("should fail to init with what git said when it exits with an error", async () => {
		const processes = withGit();
		processes.outputs.set("/bin/git", {
			code: 128,
			stdout: "",
			stderr: "fatal: not allowed\n",
		});

		const made = await gitOf(processes, new MemoryFileSystemService()).init(
			root
		);

		expect(made.isErr() && made.error.message).toBe("fatal: not allowed");
	});

	it("should fail to init with the exit code when git exits with an error and says nothing", async () => {
		const processes = withGit();
		processes.outputs.set("/bin/git", { code: 1, stdout: "", stderr: "" });

		const made = await gitOf(processes, new MemoryFileSystemService()).init(
			root
		);

		expect(made.isErr() && made.error.message).toBe(
			"git init exited with code 1."
		);
	});

	it("should init in the folder it is given", async () => {
		const processes = withGit();
		processes.outputs.set("/bin/git", { code: 0, stdout: "", stderr: "" });

		const made = await gitOf(processes, new MemoryFileSystemService()).init(
			root
		);

		expect(made.isOk()).toBe(true);
		expect(processes.execs).toEqual([
			{ file: "/bin/git", args: ["init"], cwd: root, signal: undefined },
		]);
	});

	describe("moveTracked", () => {
		const listed = (...lines: string[]) => {
			const processes = withGit();
			processes.outputs.set("/bin/git", {
				code: 0,
				stdout: lines.map((line) => `${line}\0`).join(""),
				stderr: "",
			});
			return processes;
		};
		const argsOf = (processes: MockProcessService) =>
			processes.execs.map(({ args }) => args);

		it("should move the index entries of the files git tracks under the old name, so git sees a rename that differs only in case", async () => {
			const processes = listed(
				"100644 aaa 0\tsrc/Inv/server/C.luau",
				"100755 bbb 0\tsrc/Inv/server/sub/D.luau"
			);

			await gitOf(processes, new MemoryFileSystemService()).moveTracked(
				root,
				"src/Inv/server",
				"src/Inv/Server"
			);

			expect(argsOf(processes)).toEqual([
				["ls-files", "-s", "-z", "--", "src/Inv/server"],
				[
					"update-index",
					"--force-remove",
					"--",
					"src/Inv/server/C.luau",
					"src/Inv/server/sub/D.luau",
				],
				[
					"update-index",
					"--add",
					"--cacheinfo",
					"100644,aaa,src/Inv/Server/C.luau",
					"--cacheinfo",
					"100755,bbb,src/Inv/Server/sub/D.luau",
				],
			]);
			expect(processes.execs.every(({ cwd }) => cwd === root)).toBe(true);
		});

		it("should move a tracked file that differs only in case", async () => {
			const processes = listed("100644 aaa 0\tSave@server.luau");

			await gitOf(processes, new MemoryFileSystemService()).moveTracked(
				root,
				"Save@server.luau",
				"Save@Server.luau"
			);

			expect(argsOf(processes)[2]).toEqual([
				"update-index",
				"--add",
				"--cacheinfo",
				"100644,aaa,Save@Server.luau",
			]);
		});

		it("should move many entries a bounded number at a time", async () => {
			const processes = listed(
				...Array.from(
					{ length: 150 },
					(_, index) =>
						`100644 sha${index} 0\tsrc/server/F${index}.luau`
				)
			);

			await gitOf(processes, new MemoryFileSystemService()).moveTracked(
				root,
				"src/server",
				"src/Server"
			);

			expect(argsOf(processes).map(([, flag]) => flag)).toEqual([
				"-s",
				"--force-remove",
				"--add",
				"--force-remove",
				"--add",
			]);
		});

		it("should leave an entry in a merge conflict alone", async () => {
			const processes = listed(
				"100644 aaa 0\tsrc/server/A.luau",
				"100644 bbb 1\tsrc/server/B.luau",
				"100644 ccc 2\tsrc/server/B.luau"
			);

			await gitOf(processes, new MemoryFileSystemService()).moveTracked(
				root,
				"src/server",
				"src/Server"
			);

			expect(argsOf(processes).slice(1)).toEqual([
				["update-index", "--force-remove", "--", "src/server/A.luau"],
				[
					"update-index",
					"--add",
					"--cacheinfo",
					"100644,aaa,src/Server/A.luau",
				],
			]);
		});

		it("should do nothing when git tracks nothing there", async () => {
			const processes = listed();

			await gitOf(processes, new MemoryFileSystemService()).moveTracked(
				root,
				"src/server",
				"src/Server"
			);

			expect(argsOf(processes)).toHaveLength(1);
		});

		it("should do nothing when git can't list the folder", async () => {
			const processes = withGit();
			processes.outputs.set("/bin/git", {
				code: 128,
				stdout: "",
				stderr: "fatal: not a git repository",
			});

			await gitOf(processes, new MemoryFileSystemService()).moveTracked(
				root,
				"src/server",
				"src/Server"
			);

			expect(argsOf(processes)).toHaveLength(1);
		});

		it("should do nothing without git", async () => {
			const processes = new MockProcessService();

			await gitOf(processes, new MemoryFileSystemService()).moveTracked(
				root,
				"src/server",
				"src/Server"
			);

			expect(processes.execs).toEqual([]);
		});
	});
});
