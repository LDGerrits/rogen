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
