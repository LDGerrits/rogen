import { L } from "./inventory";
import { delay, MoreLink } from "./more-link";
import { RouteViews } from "./route-views";
import { RoutingStory } from "./routing-story";

export function Routing() {
	return (
		<section className="sec alt" aria-labelledby="route-h">
			<div className="wrap">
				<div className="cols r-head">
					<h2 id="route-h" className="rv">
						How routing works
					</h2>
					<p className="rv" style={delay(80)}>
						You choose the routes and where each one points. Add{" "}
						<code>
							<L luau="@Server" ts="@server" />
						</code>
						{" to a file's name or put it in a "}
						<code>
							<L luau="Server" ts="server" />
						</code>{" "}
						folder, and it goes to ServerScriptService. Files
						without a route go to <code>*</code>.
					</p>
				</div>
			</div>
			<RoutingStory />
			<div className="wrap">
				<RouteViews
					guide={
						<MoreLink href="/docs/v2/core-concepts/routing">
							Read the routing guide
						</MoreLink>
					}
				/>
			</div>
		</section>
	);
}
