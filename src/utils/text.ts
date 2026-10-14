/** The text after a helper's first line — used where the first line becomes the dialog title. */
export function afterFirstLine(text: string): string {
  const at = text.indexOf("\n");
  return at === -1 ? text : text.slice(at + 1);
}
