export function getTimeStamp(wrapInBrackets = true): string {
	const now = new Date();
	const h = String(now.getHours()).padStart(2, "0");
	const m = String(now.getMinutes()).padStart(2, "0");
	const s = String(now.getSeconds()).padStart(2, "0");
	const timeStamp = `${h}:${m}:${s}`;
	return wrapInBrackets ? `[${timeStamp}]` : timeStamp;
}
