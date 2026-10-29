import { guides } from "./explorer";

/** The tree lines in front of row i, given each row's depth; the stylesheet draws each one. */
export function TreeGuides({ depths, i }: { depths: number[]; i: number }) {
	return (
		<span className="g" aria-hidden="true">
			{guides(depths, i).map((guide, j) => (
				<i key={j} className={`g-${guide}`} />
			))}
		</span>
	);
}
