/** PostgREST or() filter: any of `columns` is one of `ids` (used with useScopeFilter). */
export function participantFilter(columns: string[], ids: string[]) {
  const list = `(${ids.join(",")})`
  return columns.map((column) => `${column}.in.${list}`).join(",")
}
