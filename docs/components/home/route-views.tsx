"use client";

import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type CSSProperties,
	type KeyboardEvent,
	type ReactNode,
} from "react";
import { glyphs, type Service } from "./explorer";
import { disk, Name, studio, StudioIcon, type DiskRow } from "./inventory";
import { delay } from "./more-link";

type ViewId = "name" | "folder";
// Folder rows with a colour are the Client/ and Server/ routing folders.
type Row = DiskRow;

const shared = disk.filter(
	([, , , colour]) => colour !== "s" && colour !== "c"
);
const routed = (colour: Service, folder: string): Row[] => [
	[folder, 2, "", colour],
	...disk
		.filter((row) => row[3] === colour)
		.map(([name, , key]): Row => [
			name.replace(/@\w+/, ""),
			3,
			key,
			colour,
		]),
];

const views: Record<ViewId, { label: string; desc: string; rows: Row[] }> = {
	name: {
		label: "Route by name",
		desc: "Mark only the files that belong on one side. Everything else goes to ReplicatedStorage through the * route.",
		rows: disk,
	},
	folder: {
		label: "Route by folder",
		desc: "Put files in a Client or Server folder. In Studio, that folder disappears and its files sit directly in the feature's folder.",
		rows: [
			...shared.slice(0, 5),
			...routed("c", "Client/"),
			...routed("s", "Server/"),
			...shared.slice(5),
		],
	},
};
const ids = Object.keys(views) as ViewId[];

function DiskRows({ rows }: { rows: Row[] }) {
	const depths = rows.map((row) => row[1]);
	return rows.map(([name, depth, key, colour], i) => {
		const folder = name.endsWith("/");
		return (
			<li
				key={`${name}${depth}`}
				className={folder && !colour ? "b" : undefined}
				style={{ transitionDelay: `${Math.min(i, 8) * 25}ms` }}
			>
				<span className="g">{glyphs(depths, i)}</span>
				{folder && colour ? (
					<span className={`nm c-${colour}`}>{name}</span>
				) : (
					<Name name={name} colour={key ? colour : undefined} />
				)}
			</li>
		);
	});
}

/** The Route by name / Route by folder toggle over src/Inventory on disk and its result in Studio. */
export function RouteViews({
	note,
	guide,
}: {
	note: ReactNode;
	guide: ReactNode;
}) {
	const [view, setView] = useState<ViewId>("name");
	const [shown, setShown] = useState<ViewId>("name");
	const [entering, setEntering] = useState(false);
	const toggle = useRef<HTMLDivElement>(null);
	const knob = useRef<HTMLSpanElement>(null);
	const buttons = useRef<(HTMLButtonElement | null)[]>([]);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

	useLayoutEffect(() => {
		const measure = () => {
			const b = buttons.current[ids.indexOf(view)];
			if (!b || !knob.current || !toggle.current) return;
			knob.current.style.width = `${b.offsetWidth}px`;
			knob.current.style.transform = `translateX(${b.offsetLeft}px)`;
			toggle.current.dataset.ready = "";
		};
		measure();
		addEventListener("resize", measure);
		document.fonts?.ready.then(measure);
		return () => removeEventListener("resize", measure);
	}, [view]);

	// New rows mount hidden, then fade up on the next frame.
	useEffect(() => {
		if (!entering) return;
		let raf = requestAnimationFrame(() => {
			raf = requestAnimationFrame(() => setEntering(false));
		});
		return () => cancelAnimationFrame(raf);
	}, [entering]);

	useEffect(() => () => clearTimeout(timer.current), []);

	const select = (next: ViewId) => {
		setView(next);
		clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			setShown(next);
			setEntering(true);
		}, 220);
	};

	const onKeyDown = (e: KeyboardEvent, i: number) => {
		if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
		const n = 1 - i;
		buttons.current[n]?.focus();
		select(ids[n]);
	};

	const swapping = shown !== view || entering;

	return (
		<div className="routes-demo">
			<div className="rt-top rv" style={delay(120)}>
				<div
					ref={toggle}
					className="toggle"
					role="tablist"
					aria-label="Routing style"
				>
					<span ref={knob} className="knob" aria-hidden="true" />
					{ids.map((id, i) => (
						<button
							key={id}
							ref={(el) => {
								buttons.current[i] = el;
							}}
							type="button"
							role="tab"
							aria-selected={view === id}
							tabIndex={view === id ? 0 : -1}
							onClick={() => select(id)}
							onKeyDown={(e) => onKeyDown(e, i)}
						>
							{views[id].label}
						</button>
					))}
				</div>
				<p className="vdesc" aria-live="polite">
					{views[view].desc}
				</p>
			</div>
			<div className="rt-panes">
				<div className="dpane rv" style={delay(160)}>
					<div className="pane-h">
						<b>src/</b>
						<span>On disk</span>
					</div>
					<ul className={`tree${swapping ? " swap" : ""}`}>
						<DiskRows rows={views[shown].rows} />
					</ul>
				</div>
				<div className="dpane rv" style={delay(220)}>
					<div className="pane-h">
						<b>Result in Roblox Studio</b>
						<span>Same for both</span>
					</div>
					<ul className="xt">
						{studio.map(([, name, depth, icon, colour], i) => (
							<li
								key={i}
								className={`x k-${colour}${icon === "svc" ? " svc" : ""}`}
								style={{ "--d": depth } as CSSProperties}
							>
								<StudioIcon icon={icon} />
								<span className="nm">{name}</span>
							</li>
						))}
					</ul>
				</div>
			</div>
			<div className="rt-foot rv" style={delay(260)}>
				<p>{note}</p>
				{guide}
			</div>
		</div>
	);
}
