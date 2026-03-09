const test = require("node:test");
const assert = require("node:assert/strict");

const { parseSkillMarkdown } = require("../dist/main/skill-runtime.js");

test("parseSkillMarkdown parses frontmatter with CRLF newlines", () => {
  const markdown = "---\r\nname: crlf-skill\r\ndescription: CRLF skill\r\nparameters: {}\r\n---\r\nBody";
  const parsed = parseSkillMarkdown(markdown, "C:/tmp/crlf/SKILL.md");

  assert.ok(parsed);
  assert.equal(parsed.name, "crlf-skill");
  assert.equal(parsed.description, "CRLF skill");
  assert.deepEqual(parsed.parameters, {});
});
