import { NextSteps } from "../../domain/init/plan-init.js";

const indent = (line: string) => `  ${line}`;

/** The next steps as printed: long-running commands grouped, since each keeps its terminal busy. */
export const renderSteps = ({
	setup,
	run,
	darklua,
	edits,
}: NextSteps): string[] => [
	...setup,
	...(run.length > 0
		? ["Run each in its own terminal:", ...run.map(indent)]
		: []),
	...(darklua.length > 0
		? [
				"Have Darklua process your code into the sync dir:",
				...darklua.map(indent),
			]
		: []),
	...edits,
];
