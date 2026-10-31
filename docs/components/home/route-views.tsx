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
import {
	Chevron,
	ClassIcon,
	FileIcon,
	hasChildren,
	IndentGuides,
	StudioWindow,
	Triangle,
	VsCodeWindow,
} from "../ide";
import type { Service } from "./explorer";
import { disk, Name, studio, studioClass, type DiskRow } from "./inventory";
import { useLang, type Lang } from "./lang";
import { delay } from "./more-link";

type ViewId = "name" | "folder";
// Folder rows with a colour are the Client/ and Server/ routing folders.
type Row = DiskRow;

function viewsOf(lang: Lang) {
	const rows = disk[lang];
	const shared = rows.filter(
		([, , , colour]) => colour !== "s" && colour !== "c"
	);
	// A routing folder in the route's colour, with its files in it and their @ suffixes gone.
	const routed = (colour: Service, folder: string): Row[] => [
		[folder, 2, "", colour],
		...rows
			.filter((row) => row[3] === colour)
			.map(([name, , key]): Row => [
				name.replace(/@\w+/, ""),
				3,
				key,
				colour,
			]),
	];
	const [client, server] =
		lang === "ts" ? ["client", "server"] : ["Client", "Server"];
	const views: Record<ViewId, { label: string; desc: string; rows: Row[] }> =
		{
			name: {
				label: "Route by name",
				desc: "Mark only the files that belong on one side. Everything else goes to ReplicatedStorage through the * route.",
				rows,
			},
			folder: {
				label: "Route by folder",
				desc: `Put files in a ${client} or ${server} folder. In Studio, that folder disappears and its files sit directly in the feature's folder.`,
				rows: [
					...shared.slice(0, 5),
					...routed("c", `${client}/`),
					...routed("s", `${server}/`),
					...shared.slice(5),
				],
			},
		};
	return views;
}
const ids: ViewId[] = ["name", "folder"];
// The tree keeps the height of the longer view, so switching views never resizes the section.
const MAX_ROWS = Math.max(...ids.map((id) => viewsOf("luau")[id].rows.length));

function DiskRows({ rows }: { rows: Row[] }) {
	const depths = rows.map((row) => ({ depth: row[1] }));
	return rows.map(([name, depth, key, colour], i) => {
		const folder = name.endsWith("/");
		const bare = name.replace(/\/$/, "");
		return (
			<li
				key={`${name}${depth}`}
				style={
					{
						"--d": depth,
						transitionDelay: `${Math.min(i, 8) * 25}ms`,
					} as CSSProperties
				}
			>
				<IndentGuides depth={depth} />
				{folder ? (
					<Chevron open={hasChildren(depths, i)} />
				) : (
					<span className="ide-chev" />
				)}
				{!folder && <FileIcon name={name} />}
				{folder && colour ? (
					<span className={`nm c-${colour}`}>{bare}</span>
				) : (
					<Name name={bare} colour={key ? colour : undefined} />
				)}
			</li>
		);
	});
}

/** The Route by name / Route by folder toggle over src/Inventory on disk and its result in Studio. */
export function RouteViews({ guide }: { guide: ReactNode }) {
	const lang = useLang();
	const views = viewsOf(lang);
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
			</div>
			<div className="rt-panes ide">
				<div className="rt-pane rv" style={delay(160)}>
					<VsCodeWindow title="my-game">
						<div className="ide-section">
							<Chevron open />
							MY-GAME
						</div>
						<ul
							className={`ide-tree${swapping ? " swap" : ""}`}
							style={{ "--rows": MAX_ROWS } as CSSProperties}
						>
							<DiskRows rows={views[shown].rows} />
						</ul>
					</VsCodeWindow>
					{/* Every description sits in one cell, so the longest sets the height and nothing below moves. */}
					<p className="vdesc" aria-live="polite">
						{ids.map((id) => (
							<span
								key={id}
								aria-hidden={id !== view}
								data-on={id === view || undefined}
							>
								{views[id].desc}
							</span>
						))}
					</p>
				</div>
				<div className="rt-pane rv" style={delay(220)}>
					<StudioWindow>
						<ul className="ide-tree">
							{studio[lang].map(
								([, name, depth, icon], i, rows) => (
									<li
										key={i}
										style={
											{ "--d": depth } as CSSProperties
										}
									>
										<Triangle
											open={
												hasChildren(
													rows.map((row) => ({
														depth: row[2],
													})),
													i
												) || undefined
											}
										/>
										<ClassIcon
											name={studioClass(icon, name)}
										/>
										<span className="nm">{name}</span>
									</li>
								)
							)}
						</ul>
					</StudioWindow>
					<p className="vdesc">
						<span data-on>
							The result in Studio is the same for both.
						</span>
					</p>
				</div>
			</div>
			<div className="rt-foot rv" style={delay(260)}>
				{guide}
			</div>
		</div>
	);
}
