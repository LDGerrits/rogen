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
});
