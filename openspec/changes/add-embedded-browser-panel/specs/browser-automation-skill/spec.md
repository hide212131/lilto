## ADDED Requirements

### Requirement: ブラウザ連携 ON では内蔵 MCP を優先する
`browserSettings.enabled` が true の間、エージェントはブラウザ操作に `lilto_browser` を使い、外部 Chromium・`agent-browser`・別の Playwright browser を自動起動してはならない（SHALL NOT）。専用 skill は追加せず、developer instructions と MCP tool description で指示する。

#### Scenario: OFF
- **WHEN** `browserSettings.enabled` が false
- **THEN** `mcp_servers.lilto_browser` を生成せず、既存の `agent-browser` 経路を利用できる
