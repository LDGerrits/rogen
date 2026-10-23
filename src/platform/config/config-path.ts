import { relativeTo } from "../../base/path.js";

/** A config file as a command shows it, to people and in JSON: its path relative to the working folder. */
export const configPath = (cwd: string, file: string): string =>
	relativeTo(cwd, file);
