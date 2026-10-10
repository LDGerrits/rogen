import { WhereLog } from "../where-log.js";
import {
	FileLocation,
	InstanceLocation,
} from "../../../domain/build/build-service.js";
import { mockConfig } from "../../../domain/config/__tests__/mock-config-service.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";

export const reportOf = (
	configs: [
		label: string,
		files: FileLocation[],
		instances?: InstanceLocation[],
		diagnostics?: Diagnostic[],
	][],
	everyFile = false,
	errors: Diagnostic[] = [],
	modes: Parameters<typeof mockConfig>[0] = {}
) =>
	new WhereLog("/repo", {
		everyFile,
		errors,
		configs: configs.map(
			([label, files, instances = [], diagnostics = []]) => ({
				config: mockConfig({
					file: `/repo/${label}.rogen.json`,
					...modes,
				}),
				files,
				instances,
				diagnostics,
			})
		),
	});

export const lineOf = (location: FileLocation) =>
	reportOf([["default", [location]]]).lines()[0];
