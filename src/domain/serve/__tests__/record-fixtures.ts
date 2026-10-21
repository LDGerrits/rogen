export const recordFile = (
	port: number,
	project: string,
	projectFile: string,
	{
		session = "s1",
		configFile,
		clients,
		owner,
		pid,
	}: {
		session?: string;
		configFile?: string;
		clients?: number;
		owner?: number;
		pid?: number;
	} = {}
) =>
	[
		`/mock/tmp/rogen-serve/${port}.json`,
		JSON.stringify({
			host: "127.0.0.1",
			port,
			server: "rojo",
			clients,
			session,
			project,
			projectFile,
			configFile,
			owner,
			pid,
		}),
	] as const;
