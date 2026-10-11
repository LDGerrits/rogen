import { WhereAnswers } from "../where-answers.js";
import { whereDocument } from "../where-document.js";
import { WhereLog } from "../where-log.js";
import {
	FileLocation,
	InstanceLocation,
} from "../../../domain/build/build-service.js";
import { mockConfig } from "../../../domain/config/__tests__/mock-config-service.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";

type Configs = [
	label: string,
	files: FileLocation[],
	instances?: InstanceLocation[],
	diagnostics?: Diagnostic[],
][];

export const answersOf = (
	configs: Configs,
	everyFile = false,
	errors: Diagnostic[] = [],
	modes: Parameters<typeof mockConfig>[0] = {}
) =>
	new WhereAnswers({
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
				queried: [],
				diagnostics,
			})
		),
	});

export const reportOf = (...args: Parameters<typeof answersOf>) =>
	new WhereLog("/repo", answersOf(...args));

export const documentOf = (...args: Parameters<typeof answersOf>) =>
	whereDocument(answersOf(...args));

export const lineOf = (location: FileLocation) =>
	reportOf([["default", [location]]]).lines()[0];
