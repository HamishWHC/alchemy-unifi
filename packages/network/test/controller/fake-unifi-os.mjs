/* oxlint-disable no-console -- a dev server whose logs are its output */
// Test-only stand-in for the parts of UniFi OS the Network application relies on
// for API key auth. On a real console, UniFi OS validates `X-API-KEY`, then
// proxies `/proxy/network/*` to the Network app's internal API port with
// `X-ApiKeyId`; the Network app fetches the key and its creator from UniFi Core
// (127.0.0.1:11081). This process shares the controller's network namespace and
// plays both roles, with one fixed key.
import http from "node:http";

const apiKey = process.env.UNIFI_TEST_API_KEY ?? "alchemy-unifi-test-key";
const keyId = "00000000-0000-4000-8000-00000000a11c";
const userId = "00000000-0000-4000-8000-0000000000ad";
const proxyPort = Number(process.env.PROXY_PORT ?? 18080);

const json = (res, status, body) => {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
};

// Permission scopes the Network app checks on keys and users (full access).
const scopes = [
	"view:controller:network",
	"read:controller:network",
	"manage:controller",
	"manage:controller:network",
	"read:network-site:all",
	"identity:view:app:users",
];

const user = {
	unique_id: userId,
	username: "alchemy-test",
	first_name: "Alchemy",
	last_name: "Test",
	full_name: "Alchemy Test",
	email: "alchemy-test@example.invalid",
	create_time: 0,
	scopes,
	isOwner: true,
};

// The Network app identifies its host from a built-in table of UniFi OS
// hardware keyed by (architecture, sysid, cpu.id), so claim a real model.
const hardware =
	process.arch === "arm64"
		? { shortname: "UDMPRO", sysid: 59925, "cpu.id": "411fd073-00000000" }
		: { shortname: "UCKENT", sysid: 59792, "cpu.id": "57060500-fffbebbf" };

const system = {
	anonymousDeviceId: "00000000-0000-4000-8000-0000000005e7",
	hardware: {
		...hardware,
		firmwareVersion: "0.0.0",
		uuid: "00000000-0000-5000-8000-0000000005e8", // must be a version-5 UUID
		mac: "02:00:00:00:00:01",
	},
	ucore_version: "0.0.0",
	isSetup: true,
};

// UniFi Core: the endpoints the Network app calls at startup and to resolve API keys.
http.createServer((req, res) => {
	console.log(`[core] ${req.method} ${req.url}`);
	if (req.method === "GET" && req.url === "/api/system") return json(res, 200, system);
	if (req.method === "GET" && req.url === `/api/apiKey/${keyId}`) {
		return json(res, 200, { uid: keyId, name: "alchemy-unifi tests", creator_user_id: userId, scopes });
	}
	if (req.method === "GET" && req.url === `/api/users/${userId}`) return json(res, 200, user);
	return json(res, 404, { error: "not implemented by fake-unifi-os" });
}).listen(11081, "127.0.0.1");

// Console-style entry point: https://<console>/proxy/network/... with X-API-KEY.
http.createServer((req, res) => {
	const prefix = "/proxy/network";
	if (!req.url?.startsWith(`${prefix}/`)) return json(res, 404, { error: "not found" });
	if (req.headers["x-api-key"] !== apiKey) return json(res, 401, { error: "unauthorized" });
	const headers = { ...req.headers, "x-apikeyid": keyId };
	delete headers["x-api-key"];
	delete headers.host;
	const upstream = http.request(
		{ host: "127.0.0.1", port: 8080, method: req.method, path: req.url.slice(prefix.length), headers },
		(up) => {
			res.writeHead(up.statusCode ?? 502, up.headers);
			up.pipe(res);
		},
	);
	upstream.on("error", (error) => json(res, 502, { error: String(error) }));
	req.pipe(upstream);
}).listen(proxyPort, "0.0.0.0", () => console.log(`[proxy] listening on ${proxyPort}`));
