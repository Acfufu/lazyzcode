// wrap(text, width): greedy word wrap.
// - Words are sequences of non-space characters; fill each line up to `width`
//   characters, never split a word, never leave leading/trailing spaces on a line.
// - A word longer than `width` occupies a whole line by itself.
// - Empty input returns an empty string.
function wrap(text, width) {
  // BUG: this slices at exact width and splits words in the middle.
  if (text === "") return "";
  const out = [];
  for (let i = 0; i < text.length; i += width) {
    out.push(text.slice(i, i + width));
  }
  return out.join("\n");
}

export { wrap };
