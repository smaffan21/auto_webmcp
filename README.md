# webmcp-auto ⚡

> Drop one script tag on any site. Instantly agent-ready.

**webmcp-auto** scans your page for forms, buttons, and navigation links, then automatically generates and registers [WebMCP](https://webmachinelearning.github.io/webmcp/) tool definitions. No manual coding required.

Think of it like Google Analytics for AI agents — paste one script, and your site can talk to agents.

## Quick Start

### Option 1: Script tag (zero config)

```html
<script src="https://cdn.example.com/webmcp-auto.min.js"></script>
```

That's it. On page load, it will:
1. Find all `<form>` elements and create tools with auto-detected input schemas
2. Find standalone `<button>` elements and create click-action tools
3. Find nav links and create navigation tools
4. Watch for DOM changes and auto-register new tools as they appear

### Option 2: Script tag with config

```html
<script
  src="https://cdn.example.com/webmcp-auto.min.js"
  data-prefix="myshop"
  data-exclude=".admin-panel,#internal-form"
  data-max-tools="30"
  data-debug="false"
></script>
```

### Option 3: npm module

```bash
npm install webmcp-auto
```

```js
import { instrument } from 'webmcp-auto';

const auto = instrument({
  prefix: 'myshop',
  exclude: ['.admin-panel'],
  include: ['[data-action]'],        // Extra selectors to scan
  maxTools: 50,
  watch: true,                        // Re-scan on DOM changes
  onToolRegistered: (tool) => {
    console.log('New tool:', tool.name, tool.description);
  },
});

// Check what was found
console.log(auto.getTools());

// Get a manifest (for .well-known/webmcp)
console.log(auto.getToolManifest());
```

## What It Detects

| Element | Tool Type | Schema Generation |
|---------|-----------|-------------------|
| `<form>` | Submit form with field values | Auto-detects field names, types, required, enums from `<select>`, patterns |
| `<button>` (outside forms) | Click action | No inputs needed |
| `<nav> <a>` | Navigation | Returns URL and link text |
| Custom selectors | Button or form (auto-detected) | Based on element type |

### Example: A search form

Given this HTML:
```html
<form id="product-search">
  <input name="query" type="text" placeholder="Search products..." required>
  <select name="category">
    <option value="shoes">Shoes</option>
    <option value="shirts">Shirts</option>
    <option value="pants">Pants</option>
  </select>
  <input name="maxPrice" type="number" min="0" max="1000">
  <button type="submit">Search</button>
</form>
```

webmcp-auto generates:
```json
{
  "name": "product_search",
  "description": "Submit a form (fields: query, category, maxPrice)",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Search products..."
      },
      "category": {
        "type": "string",
        "enum": ["shoes", "shirts", "pants"]
      },
      "maxPrice": {
        "type": "number",
        "minimum": 0,
        "maximum": 1000
      }
    },
    "required": ["query"]
  }
}
```

An AI agent can now call `product_search({ query: "red sneakers", category: "shoes", maxPrice: 100 })` — no DOM scraping needed.

## How It Works

```
Page loads
    │
    ▼
┌──────────────────────┐
│  Scan DOM for:       │
│  • <form> elements   │
│  • <button> elements │
│  • <nav> <a> links   │
│  • Custom selectors  │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  For each element:   │
│  1. Generate name    │
│  2. Generate schema  │
│  3. Create handler   │
│  4. Register tool    │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  MutationObserver    │
│  watches for new     │
│  elements → re-scan  │
└──────────────────────┘
```

## Framework Compatibility

webmcp-auto works with any frontend framework because it:
- Reads from the DOM (not framework state)
- Dispatches native `input`, `change`, and `submit` events
- Uses `MutationObserver` to detect React/Vue/Svelte re-renders

Tested with: Static HTML, React, Vue, Next.js, Shopify themes, WordPress.

## Combining with webmcp-guard

For security, wrap the auto-instrumentor with [webmcp-guard](https://github.com/smaffan/webmcp-guard):

```js
import { instrument } from 'webmcp-auto';
import { createGuard } from 'webmcp-guard';

const guard = createGuard({ defaultRateLimit: 10 });

instrument({
  onToolRegistered: (tool) => {
    // Re-register each auto-detected tool through the security guard
    guard.registerTool(tool, {
      permission: tool.annotations?.readOnlyHint ? 'read-only' : 'write',
      rateLimit: 15,
    });
  }
});
```

## API

### `instrument(config?)`

Returns an object with:

| Method | Description |
|--------|-------------|
| `scan()` | Manually trigger re-scan |
| `getTools()` | Get all registered tools as JSON |
| `getToolManifest()` | Get a `.well-known/webmcp` manifest |
| `destroy()` | Unregister all tools and stop watching |
| `stopWatching()` | Stop DOM mutation observer |

### Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `prefix` | `string` | `""` | Tool name prefix (e.g., `"myshop"`) |
| `exclude` | `string[]` | `[]` | CSS selectors to skip |
| `include` | `string[]` | `[]` | Extra selectors to scan |
| `maxTools` | `number` | `50` | Safety limit |
| `watch` | `boolean` | `true` | Re-scan on DOM changes |
| `debug` | `boolean` | `true` | Console logging |
| `onToolRegistered` | `function` | — | Callback per tool |

## License

MIT
