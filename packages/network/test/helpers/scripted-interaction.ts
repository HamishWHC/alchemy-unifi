import * as Interaction from "alchemy/Interaction";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";

export interface Prompt {
	readonly kind: "text" | "password" | "confirm" | "select" | "multiSelect";
	readonly message: string;
	readonly options?: ReadonlyArray<{
		readonly value: unknown;
		readonly label: string;
		readonly description?: string | undefined;
	}>;
}

/**
 * An `Interaction` answering each prompt with the value whose key its message
 * starts with, recording every prompt. A select answer must be one of the
 * prompt's option values. An unanswered or mistyped prompt is a defect.
 */
export const scriptedInteraction = (answers: Record<string, unknown>) => {
	const prompts: Prompt[] = [];
	const lookup = (prompt: Prompt) =>
		Effect.suspend(() => {
			prompts.push(prompt);
			const key = Object.keys(answers).find((k) => prompt.message.startsWith(k));
			return key === undefined
				? Effect.die(`unexpected ${prompt.kind} prompt: ${prompt.message}`)
				: Effect.succeed(answers[key]);
		});
	const text = (kind: "text" | "password") => (options: { readonly message: string }) =>
		lookup({ kind, message: options.message }).pipe(
			Effect.filterOrElse(Predicate.isString, () => Effect.die(`expected a string for: ${options.message}`)),
		);
	const service: Interaction.Interaction["Service"] = {
		output: {
			info: () => Effect.void,
			success: () => Effect.void,
			warning: () => Effect.void,
			error: () => Effect.void,
		},
		prompt: {
			text: text("text"),
			password: text("password"),
			confirm: (options) =>
				lookup({ kind: "confirm", message: options.message }).pipe(
					Effect.filterOrElse(Predicate.isBoolean, () =>
						Effect.die(`expected a boolean for: ${options.message}`),
					),
				),
			select: (options) =>
				lookup({ kind: "select", message: options.message, options: options.options }).pipe(
					Effect.flatMap((answer) => {
						const choice = options.options.find((o) => o.value === answer);
						return choice === undefined
							? Effect.die(`'${String(answer)}' is not an option for: ${options.message}`)
							: Effect.succeed(choice.value);
					}),
				),
			multiSelect: (options) =>
				lookup({ kind: "multiSelect", message: options.message, options: options.options }).pipe(
					Effect.map((answer) =>
						options.options
							.filter((o) => Array.isArray(answer) && answer.includes(o.value))
							.map((o) => o.value),
					),
				),
			awaitExternal: () => Effect.die("unexpected external authorization"),
		},
		task: (_options, effect) => effect,
	};
	return { service, prompts };
};
