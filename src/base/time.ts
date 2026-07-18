export function getTimeStamp(includeBrackets = true): string {
	const now = new Date();
	const h = String(now.getHours()).padStart(2, "0");
	const m = String(now.getMinutes()).padStart(2, "0");
	const s = String(now.getSeconds()).padStart(2, "0");
	return includeBrackets ? `[${h}:${m}:${s}]` : `${h}:${m}:${s}`;
}
