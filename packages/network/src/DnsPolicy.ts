import * as Sdk from "@alchemy-unifi/network-sdk";
import { Unowned } from "alchemy/AdoptPolicy";
import type { Diff } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { withConnection } from "./Connection.ts";
import { type DistributiveOmit, isCurrent, omitKeys } from "./internal/Fields.ts";
import { plannedString, UNKNOWN } from "./internal/Plan.ts";
import { captureServices } from "./internal/Services.ts";
import type { Providers } from "./Providers.ts";
import * as ReadCache from "./ReadCache.ts";
import { resolveSite } from "./Site.ts";

/**
 * Props are the Integration API's DNS policy body plus `site`. `type` picks
 * the kind: a record (`"A_RECORD"`, `"AAAA_RECORD"`, `"CNAME_RECORD"`,
 * `"MX_RECORD"`, `"SRV_RECORD"`, `"TXT_RECORD"`) or `"FORWARD_DOMAIN"`
 * (send a domain's queries to another DNS server).
 */
export type DnsPolicyProps = Sdk.CreateOrUpdateDNSPolicy & {
	/** Site to create the policy in. @default the profile's site, else the console's only site */
	site?: string;
};

export interface DnsPolicyAttributes {
	siteId: string;
	dnsPolicyId: string;
	type: DnsPolicyProps["type"];
	domain: string;
	/** The whole policy as the console reports it, so `alchemy drift` sees any change. */
	config: DistributiveOmit<Sdk.DNSPolicy, "id" | "metadata">;
}

export interface DnsPolicy extends Resource<
	"UnifiNetwork.DnsPolicy",
	DnsPolicyProps,
	DnsPolicyAttributes,
	never,
	Providers
> {}

const loadPolicies = (siteId: string) => withConnection(Stream.runCollect(Sdk.getDnsPolicyPage.items({ siteId })));
const policiesKey = ReadCache.key<ReadonlyArray<Sdk.DNSPolicy>, Effect.Error<ReturnType<typeof loadPolicies>>>(
	"dnsPolicies",
);

/** A site's DNS policies, listed once per run. */
export const listDnsPolicies = (siteId: string) => ReadCache.cached(policiesKey, siteId, loadPolicies(siteId));

const toAttributes = (siteId: string, policy: Sdk.DNSPolicy): DnsPolicyAttributes => {
	const { id, metadata: _metadata, ...config } = policy;
	return { siteId, dnsPolicyId: id, type: policy.type, domain: policy.domain, config };
};

/** Fields the console reports but rejects in request bodies. */
const READ_ONLY = ["id", "metadata"];

/** A policy by ID, from the run's cached list, which returns whole policies (one request for every policy in a plan). */
const getPolicy = (siteId: string, dnsPolicyId: string) =>
	listDnsPolicies(siteId).pipe(Effect.map((policies) => policies.find((p) => p.id === dnsPolicyId)));

/**
 * The existing policy `body` describes: the only one with its type and
 * domain, or, when a domain has several records of that type (e.g. two A
 * records), the only one of those whose other fields match too.
 */
const findExisting = (policies: ReadonlyArray<Sdk.DNSPolicy>, body: Sdk.CreateOrUpdateDNSPolicy) => {
	const sameName = policies.filter((p) => p.type === body.type && p.domain === body.domain);
	const candidates = sameName.length > 1 ? sameName.filter((p) => isCurrent(body, omitKeys(p, READ_ONLY))) : sameName;
	const [policy] = candidates;
	return candidates.length === 1 ? policy : undefined;
};

/**
 * A local DNS record or forwarding rule on the gateway. DNS policies have no
 * name, so existing ones are adopted with `--adopt` by type and domain (and,
 * when a domain has several records of that type, by their values).
 * Changing `type` updates the policy in place.
 *
 * @example
 * ```ts
 * yield* UnifiNetwork.DnsPolicy("home-assistant", {
 *   type: "A_RECORD",
 *   enabled: true,
 *   domain: "ha.home.arpa",
 *   ipv4Address: "192.168.2.20",
 *   ttlSeconds: 300,
 * });
 * ```
 */
export const DnsPolicy = Resource<DnsPolicy>("UnifiNetwork.DnsPolicy");

export const DnsPolicyProvider = () =>
	Provider.effect(
		DnsPolicy,
		Effect.gen(function* () {
			const run = yield* captureServices;

			return DnsPolicy.Provider.of({
				list: () =>
					run(
						Effect.gen(function* () {
							const site = yield* resolveSite();
							return (yield* listDnsPolicies(site.id)).map((policy) => toAttributes(site.id, policy));
						}),
					),

				read: ({ olds, output }) =>
					run(
						Effect.gen(function* () {
							if (output !== undefined) {
								const policy = yield* getPolicy(output.siteId, output.dnsPolicyId);
								return policy === undefined ? undefined : toAttributes(output.siteId, policy);
							}
							const site = yield* resolveSite(olds.site);
							const { site: _site, ...body } = olds;
							const policy = findExisting(yield* listDnsPolicies(site.id), body);
							return policy === undefined ? undefined : Unowned(toAttributes(site.id, policy));
						}),
					),

				diff: ({ news, output }) =>
					run(
						Effect.gen(function* () {
							const siteProp = plannedString(news, "site");
							if (output === undefined || siteProp === UNKNOWN) return undefined;
							const site = yield* resolveSite(siteProp);
							if (site.id !== output.siteId) return { action: "replace" } satisfies Diff;
							return undefined;
						}),
					),

				reconcile: ({ news, output }) =>
					run(
						Effect.gen(function* () {
							const site = yield* resolveSite(news.site);
							const { site: _site, ...body } = news;
							const observed =
								output !== undefined && output.siteId === site.id
									? yield* getPolicy(site.id, output.dnsPolicyId)
									: undefined;
							const write = ReadCache.invalidating(policiesKey, site.id);
							if (observed === undefined) {
								const created = yield* withConnection(
									Sdk.createDnsPolicy({ siteId: site.id, body }),
								).pipe(write);
								return toAttributes(site.id, created);
							}
							if (isCurrent(body, omitKeys(observed, READ_ONLY))) return toAttributes(site.id, observed);
							const updated = yield* withConnection(
								Sdk.updateDnsPolicy({ siteId: site.id, dnsPolicyId: observed.id, body }),
							).pipe(write);
							return toAttributes(site.id, updated);
						}),
					),

				delete: ({ output }) =>
					run(
						withConnection(
							Sdk.deleteDnsPolicy({ siteId: output.siteId, dnsPolicyId: output.dnsPolicyId }),
						).pipe(
							Effect.asVoid,
							Effect.catchTag("NotFound", () => Effect.void),
							ReadCache.invalidating(policiesKey, output.siteId),
						),
					),
			});
		}),
	);
