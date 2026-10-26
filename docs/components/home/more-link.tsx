import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

/** The reveal delay of an element, in ms after it scrolls into view. */
export const delay = (ms: number) => ({ "--dl": `${ms}ms` }) as CSSProperties;

export function MoreLink({
	href,
	children,
	dl = 0,
}: {
	href: string;
	children: ReactNode;
	dl?: number;
}) {
	return (
		<Link className="link rv" style={delay(dl)} href={href}>
			{children} <span aria-hidden="true">→</span>
		</Link>
	);
}
