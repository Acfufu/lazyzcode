// slug(s): lowercase, trim, collapse every whitespace run into a single hyphen.
export function slug(s) {
  return s.trim().toLowerCase().replace(/\s+/g, "-");
}
