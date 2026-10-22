export const recordFile = (
	port: number,
	project: string,
	projectFile: string,
	{
		session = "s1",
		configFile,
		owner,
		pid,
	}: {
		session?: string;
		configFile?: string;
		owner?: number;
		pid?: number;
	} = {}
) =>
	[
		`/mock/tmp/rogen-serve/${port}.json`,
		JSON.stringify({
			host: "127.0.0.1",
			port,
			session,
			project,
			projectFile,
			configFile,
			owner,
			pid,
		}),
	] as const;
