// Toggle the Nth `- [ ] / - [x]` line in `content`. Returns new content.
export function toggleCheckboxLine(content, index) {
  const lines = String(content || "").split("\n");
  let seen = -1;
  for (let i = 0; i < lines.length; i += 1) {
    // Require `]` + whitespace so this counts the SAME well-formed checkboxes
    // renderNoteMarkdown renders (a bare `- [x]` is not a togglable checkbox).
    const m = lines[i].match(/^(\s*-\s\[)( |x|X)(\]\s.*)$/);
    if (!m) continue;
    seen += 1;
    if (seen === index) {
      const next = m[2].toLowerCase() === "x" ? " " : "x";
      lines[i] = `${m[1]}${next}${m[3]}`;
      break;
    }
  }
  return lines.join("\n");
}
