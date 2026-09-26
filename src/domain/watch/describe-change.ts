export interface WatchChange {
	readonly sourceFiles: number;
	readonly configFiles: readonly string[];
	readonly reloaded: boolean;
}

export function describeChange({
	sourceFiles,
	configFiles,
	reloaded,
}: WatchChange): string {
	const parts: string[] = [];
	if (sourceFiles > 0)
		parts.push(
			`${sourceFiles} ${sourceFiles === 1 ? "file" : "files"} changed`
		);
	if (configFiles.length > 0) parts.push(`${configFiles.join(", ")} changed`);
	if (reloaded) parts.push("reloaded");
	return parts.join(" · ");
}

export function clockTime(date: Date): string {
	return [date.getHours(), date.getMinutes(), date.getSeconds()]
		.map((part) => String(part).padStart(2, "0"))
		.join(":");
}
