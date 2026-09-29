import { compareStrings } from "../../../base/collection.js";
import { BuildRule } from "../build-record.js";
import { ScanDiagnostics } from "../scan-diagnostics.js";

export const unresolvedLink: BuildRule = ({ leftOut }) =>
	[...leftOut]
		.filter(([, why]) => why.status === "skipped")
		.map(([link]) => link)
		.sort(compareStrings)
		.map(ScanDiagnostics.unresolvedLink);
