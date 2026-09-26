// Regression tests from Codex's task 1 review of five real products (room message #17).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endpointCandidates, extractToolNames, pickInstall, extractFacts } from '../src/review.js';

test('endpoint candidates skip docs, badges, install redirects and localhost', () => {
  const text = [
    'See https://docs.cline.bot/mcp/configuring-mcp-servers and https://kiro.dev/docs/mcp/',
    '[![Install](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=x)',
    'https://insiders.vscode.dev/redirect/mcp/install?name=github&config=%7B%7D',
    '"url": "http://localhost:8931/mcp"',
  ].join('\n');
  assert.deepEqual(endpointCandidates(text), []);
});

test('endpoint candidates keep the real endpoint and rank config values first', () => {
  const text = 'Docs at https://example.com/mcp\nuse the Context7 server URL `https://mcp.context7.com/mcp` with your client\n{"url": "https://api.githubcopilot.com/mcp/"}';
  const c = endpointCandidates(text);
  // Both config-context endpoints outrank a bare mention.
  assert.deepEqual(c.slice(0, 2).sort(), ['https://api.githubcopilot.com/mcp/', 'https://mcp.context7.com/mcp']);
  assert.equal(c.at(-1), 'https://example.com/mcp');
});

test('tool names are found in bold, kebab-case and backtick list styles', () => {
  const text = '### Tools\n- **browser_click**\n  - Title: Click\n- `resolve-library-id`: Resolves a name\n- `query-docs`: Retrieves docs\nCall `get_me` first.';
  const names = extractToolNames(text);
  for (const n of ['browser_click', 'resolve-library-id', 'query-docs', 'get_me']) assert.ok(names.includes(n), n);
});

test('install command is the product\'s own, not a sibling project', () => {
  const text = 'Building in TypeScript? Same ideas, `npm install @prefecthq/fastmcp-ts`.\n\n## Installation\n\n```bash\nuv add fastmcp\n```';
  assert.equal(pickInstall(text, 'fastmcp'), 'uv add fastmcp');
});

test('a CLI tool is judged as a CLI, with real invocations counted', () => {
  const text = '# Aider\n\nAider lets you pair program with LLMs in your terminal to edit code in your local repo.\n\n```bash\npython -m pip install aider-install\naider-install\n\n# DeepSeek\naider --model deepseek --api-key deepseek=<key>\n\naider --model sonnet --api-key anthropic=<key>\n```';
  const f = extractFacts(text, { name: 'aider' });
  assert.equal(f.kind, 'cli');
  assert.ok(f.command_lines >= 3);
  assert.equal(f.install_command, 'python -m pip install aider-install');
});

test('a framework is judged as a framework', () => {
  const text = '# FastMCP\n\nFastMCP is the fast, Pythonic framework for building MCP servers and clients.\n\n```python\nfrom fastmcp import FastMCP\nmcp = FastMCP("Demo")\n@mcp.tool\ndef add(a: int, b: int) -> int:\n    return a + b\n```';
  const f = extractFacts(text, { name: 'fastmcp' });
  assert.equal(f.kind, 'framework');
  assert.equal(f.has_code_api, true);
});

test('smoke call only picks tools that are safe to call blind', async () => {
  const { pickSmokeTool, sampleArgs } = await import('../src/probe.js');
  const tools = [
    { name: 'delete_repo', inputSchema: { required: [] } },
    { name: 'browser_click', inputSchema: { required: [] } },
    { name: 'get_file', inputSchema: { properties: { blob: { type: 'object' } }, required: ['blob'] } },
    { name: 'search_docs', inputSchema: { properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1 } }, required: ['query', 'limit'] } },
    { name: 'list_things', inputSchema: { required: [] } },
  ];
  assert.equal(pickSmokeTool(tools).name, 'list_things');
  assert.equal(pickSmokeTool(tools.slice(0, 4)).name, 'search_docs');
  assert.deepEqual(sampleArgs(tools[3]), { query: 'react', limit: 1 });
  assert.equal(pickSmokeTool(tools.slice(0, 3)), null);
  // An explicit read-only annotation wins over the name; destructive never runs.
  assert.equal(pickSmokeTool([{ name: 'do_it', annotations: { readOnlyHint: true }, inputSchema: {} }]).name, 'do_it');
  assert.equal(pickSmokeTool([{ name: 'get_x', annotations: { destructiveHint: true }, inputSchema: {} }]), null);
});
