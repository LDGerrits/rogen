import { relativeTo } from "../../base/path.js";

export const configPath = (cwd: string, file: string): string =>
	relativeTo(cwd, file);
