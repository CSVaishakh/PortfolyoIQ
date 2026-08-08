/**
 * Joins class names, dropping falsy entries.
 *
 * Deliberately not `tailwind-merge`: the components here express variants as
 * complete, mutually exclusive class strings rather than overlapping fragments,
 * so there is nothing to de-conflict and no reason to ship a resolver for it.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
