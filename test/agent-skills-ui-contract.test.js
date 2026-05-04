const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("settings-modal runs Agent Skills update checks on startup and keeps manual recheck next to refresh", () => {
  const content = fs.readFileSync("src/renderer/components/settings-modal.ts", "utf8");
  const skillsStart = content.indexOf("private _renderSkills()");
  const pluginsStart = content.indexOf("private _renderPlugins()", skillsStart);
  assert.notEqual(skillsStart, -1);
  assert.notEqual(pluginsStart, -1);

  const skillsRender = content.slice(skillsStart, pluginsStart);
  assert.match(content, /void this\._checkUpdates\(\{ automatic: true \}\)/);
  assert.match(content, /private _startupSkillUpdateCheckStarted = false/);
  assert.match(content, /private async _checkUpdates\(options: \{ automatic\?: boolean \} = \{\}\)/);
  assert.match(skillsRender, /@click=\$\{this\._loadSkills\}/);
  assert.match(skillsRender, /@click=\$\{\(\) => this\._checkUpdates\(\)\}/);
  assert.match(skillsRender, /&#12450;&#12483;&#12503;&#12487;&#12540;&#12488;&#12434;&#30906;&#35469;/);
  assert.ok(
    skillsRender.indexOf("_skillUpdatesChecked") < skillsRender.indexOf("installed-skills-table"),
    "update check results should render above the installed skills list"
  );
  assert.doesNotMatch(skillsRender, /GitHub \/ GitLab/);
});
