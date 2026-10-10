import { RunningRogen, bundleCli, createProject } from "./harness.js";

/** The config and template every serve test starts from. */
export const config = (extra: Record<string, unknown> = {}) =>
	JSON.stringify({
		rootDirs: ["src"],
		routes: { server: "ServerScriptService", "*": "ReplicatedStorage" },
		template: "template.project.json",
		...extra,
	});

export const template = (port: number, name = "Game") =>
	JSON.stringify({
		name,
		servePort: port,
		tree: { $className: "DataModel" },
	});

/** The files of a project that serves default on `port`. */
export const projectFiles = (port: number) => ({
	"default.rogen.json": config(),
	"template.project.json": template(port),
	"src/A.server.luau": "",
});

/** A fresh project per test, served on a random port from `firstPort`; `start` takes another checkout's `dir`. */
export function useServeProject(
	firstPort: number,
	files: Readonly<Record<string, string>> = {}
) {
	let bundle: ReturnType<typeof bundleCli>;
	let project: ReturnType<typeof createProject>;
	let sessions: RunningRogen[];
	let port: number;

	beforeAll(() => {
		bundle = bundleCli();
	});

	afterAll(() => {
		bundle.dispose();
	});

	beforeEach(() => {
		port = firstPort + Math.floor(Math.random() * 2000);
		project = createProject({ ...files, ...projectFiles(port) });
		sessions = [];
	});

	afterEach(async () => {
		await Promise.all(sessions.map((session) => session.stop()));
		project.dispose();
	});

	return {
		get cli() {
			return bundle.cli;
		},
		get dir() {
			return project.dir;
		},
		get port() {
			return port;
		},
		start(args: readonly string[] = [], dir = project.dir) {
			const session = new RunningRogen(
				bundle.cli,
				dir,
				args,
				dir,
				"serve"
			);
			sessions.push(session);
			return session;
		},
	};
}
