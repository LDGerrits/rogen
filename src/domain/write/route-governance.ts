import path from "path";

export class RouteGovernance {
	constructor(private readonly routes: ReadonlyMap<string, string>) {}

	within(dir: string): string | undefined {
		return this.routes.get(dir);
	}

	above(resource: string): string | undefined {
		return this.within(path.posix.dirname(resource));
	}
}
