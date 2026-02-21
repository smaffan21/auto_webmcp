/**
 * webmcp-auto v0.1.0
 * Auto-instrumentor for WebMCP — drop one <script> tag on any site and it
 * automatically discovers forms, buttons, links, and interactive elements,
 * then generates and registers WebMCP tool definitions for them.
 *
 * Usage (simplest — paste in any page):
 *
 *   <script src="https://cdn.example.com/webmcp-auto.js"></script>
 *
 * Usage (with config):
 *
 *   import { instrument } from 'webmcp-auto';
 *
 *   instrument({
 *     exclude: ['.admin-panel', '#internal-form'],  // CSS selectors to skip
 *     include: ['form', 'button', '[data-action]'],  // Additional selectors
 *     prefix: 'mysite',                               // Tool name prefix
 *     onToolRegistered: (tool) => console.log('Registered:', tool.name),
 *     watch: true,                                     // Re-scan on DOM changes
 *   });
 */

// ─── Configuration ────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  /** CSS selectors to exclude from instrumentation */
  exclude: [],
  /** Additional CSS selectors to scan (forms and buttons are always included) */
  include: [],
  /** Prefix for generated tool names */
  prefix: "",
  /** Callback when a tool is registered */
  onToolRegistered: null,
  /** Watch for DOM changes and re-instrument */
  watch: true,
  /** Maximum number of tools to register (safety limit) */
  maxTools: 50,
  /** Log activity to console */
  debug: true,
};

// ─── Utility: Generate clean tool names ───────────────────────────────────────

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/[\s_-]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}

function generateToolName(element, prefix, context) {
  const parts = [];
  if (prefix) parts.push(prefix);

  // Try to derive a meaningful name from the element
  if (element.getAttribute("toolname")) {
    // Already has WebMCP toolname — skip (it's manually instrumented)
    return null;
  }

  const id = element.id;
  const name = element.getAttribute("name");
  const ariaLabel = element.getAttribute("aria-label");
  const action = element.getAttribute("action");
  const textContent = element.textContent?.trim().slice(0, 30);

  if (context === "form") {
    if (id) parts.push(slugify(id));
    else if (name) parts.push(slugify(name));
    else if (action) parts.push("submit_" + slugify(action.split("/").pop()));
    else parts.push("form_" + Math.random().toString(36).slice(2, 6));
  } else if (context === "button") {
    if (ariaLabel) parts.push(slugify(ariaLabel));
    else if (textContent) parts.push(slugify(textContent));
    else if (id) parts.push(slugify(id));
    else parts.push("action_" + Math.random().toString(36).slice(2, 6));
  } else if (context === "link") {
    if (ariaLabel) parts.push("navigate_" + slugify(ariaLabel));
    else if (textContent) parts.push("navigate_" + slugify(textContent));
    else parts.push("navigate_" + Math.random().toString(36).slice(2, 6));
  } else if (context === "input") {
    if (name) parts.push("set_" + slugify(name));
    else if (id) parts.push("set_" + slugify(id));
    else parts.push("set_field_" + Math.random().toString(36).slice(2, 6));
  }

  const toolName = parts.join("_");
  return toolName || null;
}

// ─── Utility: Generate descriptions ──────────────────────────────────────────

function generateDescription(element, context) {
  const ariaLabel = element.getAttribute("aria-label");
  const title = element.getAttribute("title");
  const placeholder = element.getAttribute("placeholder");
  const text = element.textContent?.trim().slice(0, 50);

  if (context === "form") {
    const method = (element.method || "GET").toUpperCase();
    const action = element.action || "";
    const inputs = element.querySelectorAll("input, select, textarea");
    const fieldNames = Array.from(inputs)
      .map((i) => i.name || i.id || i.placeholder)
      .filter(Boolean)
      .slice(0, 5);

    let desc = `Submit a form`;
    if (ariaLabel) desc = `Submit: ${ariaLabel}`;
    else if (title) desc = `Submit: ${title}`;
    if (fieldNames.length > 0) desc += ` (fields: ${fieldNames.join(", ")})`;
    return desc;
  }

  if (context === "button") {
    if (ariaLabel) return `Click action: ${ariaLabel}`;
    if (title) return `Click action: ${title}`;
    if (text) return `Click: ${text}`;
    return "Trigger a button action";
  }

  if (context === "link") {
    const href = element.getAttribute("href") || "";
    if (ariaLabel) return `Navigate to: ${ariaLabel}`;
    if (text) return `Navigate to: ${text}`;
    return `Navigate to ${href}`;
  }

  if (context === "input") {
    const type = element.type || "text";
    const name = element.name || element.id || "";
    if (placeholder) return `Set ${name || "field"}: ${placeholder}`;
    return `Set ${type} field: ${name}`;
  }

  return "Interact with page element";
}

// ─── Form Scanner ─────────────────────────────────────────────────────────────

function scanForm(form) {
  const inputs = form.querySelectorAll("input, select, textarea");
  const properties = {};
  const required = [];

  for (const input of inputs) {
    const fieldName = input.name || input.id;
    if (!fieldName) continue;

    // Skip hidden and submit fields
    if (input.type === "hidden" || input.type === "submit") continue;

    const prop = { type: "string" };

    // Map HTML input types to JSON Schema types
    switch (input.type) {
      case "number":
      case "range":
        prop.type = "number";
        if (input.min) prop.minimum = parseFloat(input.min);
        if (input.max) prop.maximum = parseFloat(input.max);
        break;
      case "checkbox":
        prop.type = "boolean";
        break;
      case "email":
        prop.type = "string";
        prop.format = "email";
        break;
      case "url":
        prop.type = "string";
        prop.format = "uri";
        break;
      case "date":
        prop.type = "string";
        prop.format = "date";
        break;
      case "tel":
        prop.type = "string";
        prop.format = "phone";
        break;
      default:
        prop.type = "string";
    }

    // Add description from placeholder or label
    const label = form.querySelector(`label[for="${input.id}"]`);
    if (label) prop.description = label.textContent.trim();
    else if (input.placeholder) prop.description = input.placeholder;

    // Handle <select> options
    if (input.tagName === "SELECT") {
      const options = Array.from(input.options)
        .map((o) => o.value)
        .filter((v) => v);
      if (options.length > 0 && options.length <= 20) {
        prop.enum = options;
      }
    }

    // Handle pattern validation
    if (input.pattern) {
      prop.pattern = input.pattern;
    }

    properties[fieldName] = prop;

    if (input.required) {
      required.push(fieldName);
    }
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

// ─── Form Handler Generator ──────────────────────────────────────────────────

function createFormHandler(form) {
  return async (input) => {
    const inputs = form.querySelectorAll("input, select, textarea");

    // Fill in the form fields
    for (const inputEl of inputs) {
      const fieldName = inputEl.name || inputEl.id;
      if (!fieldName || !(fieldName in input)) continue;

      const value = input[fieldName];

      if (inputEl.type === "checkbox") {
        inputEl.checked = Boolean(value);
      } else if (inputEl.tagName === "SELECT") {
        inputEl.value = value;
      } else {
        inputEl.value = value;
      }

      // Dispatch input event so React/Vue/Angular pick up the change
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      inputEl.dispatchEvent(new Event("change", { bubbles: true }));
    }

    // Submit the form
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    return {
      success: true,
      message: `Form submitted with ${Object.keys(input).length} fields`,
      fields: Object.keys(input),
    };
  };
}

// ─── Button Handler Generator ────────────────────────────────────────────────

function createButtonHandler(button) {
  return async () => {
    button.click();
    return {
      success: true,
      message: `Clicked: ${button.textContent?.trim().slice(0, 50) || "button"}`,
    };
  };
}

// ─── Link Handler Generator ──────────────────────────────────────────────────

function createLinkHandler(link) {
  return async () => {
    const href = link.getAttribute("href");
    if (href && !href.startsWith("javascript:")) {
      // Don't actually navigate — return the URL for the agent to decide
      return {
        success: true,
        url: new URL(href, window.location.href).toString(),
        text: link.textContent?.trim().slice(0, 50),
        message: `Link target: ${href}`,
      };
    }
    // For JS links, click them
    link.click();
    return { success: true, message: "Link activated" };
  };
}

// ─── Main Instrument Function ─────────────────────────────────────────────────

export function instrument(userConfig = {}) {
  const config = { ...DEFAULT_CONFIG, ...userConfig };
  const registeredTools = new Map();
  let toolCount = 0;

  function log(...args) {
    if (config.debug) {
      console.log("%c[webmcp-auto]", "color:#F59E0B;font-weight:bold", ...args);
    }
  }

  function isExcluded(element) {
    for (const selector of config.exclude) {
      if (element.matches(selector) || element.closest(selector)) {
        return true;
      }
    }
    return false;
  }

  function getModelContext() {
    if (typeof navigator !== "undefined" && navigator.modelContext) {
      return navigator.modelContext;
    }
    return null;
  }

  function registerWebMCPTool(tool) {
    if (toolCount >= config.maxTools) {
      log(`⚠️ Max tools (${config.maxTools}) reached, skipping: ${tool.name}`);
      return;
    }

    if (registeredTools.has(tool.name)) {
      return; // Already registered
    }

    const mc = getModelContext();
    if (mc && mc.registerTool) {
      try {
        mc.registerTool(tool);
      } catch (e) {
        log(`⚠️ Failed to register with WebMCP: ${tool.name}`, e.message);
      }
    }

    registeredTools.set(tool.name, tool);
    toolCount++;

    if (config.onToolRegistered) {
      config.onToolRegistered(tool);
    }

    log(`✅ Registered: ${tool.name} — "${tool.description}"`);
  }

  // ── Scan the page ─────────────────────────────────────────────────────────

  function scan() {
    const prefix = config.prefix;
    log("🔍 Scanning page...");

    // 1. Scan all forms
    const forms = document.querySelectorAll("form");
    for (const form of forms) {
      if (isExcluded(form)) continue;

      // Skip forms that already have WebMCP toolname attribute
      if (form.getAttribute("toolname")) continue;

      const toolName = generateToolName(form, prefix, "form");
      if (!toolName) continue;

      const schema = scanForm(form);
      if (Object.keys(schema.properties).length === 0) continue;

      registerWebMCPTool({
        name: toolName,
        description: generateDescription(form, "form"),
        inputSchema: schema,
        handler: createFormHandler(form),
        annotations: { readOnlyHint: false, destructiveHint: false },
      });
    }

    // 2. Scan buttons (not inside forms — those are handled by form submission)
    const buttons = document.querySelectorAll(
      'button:not(form button), [role="button"], input[type="button"]'
    );
    for (const button of buttons) {
      if (isExcluded(button)) continue;
      if (button.closest("form")) continue; // Skip form buttons
      if (!button.textContent?.trim() && !button.getAttribute("aria-label")) continue;

      const toolName = generateToolName(button, prefix, "button");
      if (!toolName) continue;

      registerWebMCPTool({
        name: toolName,
        description: generateDescription(button, "button"),
        inputSchema: { type: "object", properties: {} },
        handler: createButtonHandler(button),
        annotations: { readOnlyHint: false },
      });
    }

    // 3. Scan navigation links (primary nav only to avoid noise)
    const navLinks = document.querySelectorAll("nav a, [role='navigation'] a, header a");
    for (const link of navLinks) {
      if (isExcluded(link)) continue;

      const href = link.getAttribute("href");
      if (!href || href === "#" || href.startsWith("javascript:")) continue;

      const toolName = generateToolName(link, prefix, "link");
      if (!toolName) continue;

      registerWebMCPTool({
        name: toolName,
        description: generateDescription(link, "link"),
        inputSchema: { type: "object", properties: {} },
        handler: createLinkHandler(link),
        annotations: { readOnlyHint: true },
      });
    }

    // 4. Scan additional selectors from config.include
    for (const selector of config.include) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        if (isExcluded(el)) continue;

        const context = el.tagName === "FORM" ? "form" : "button";
        const toolName = generateToolName(el, prefix, context);
        if (!toolName) continue;

        const handler = context === "form" ? createFormHandler(el) : createButtonHandler(el);
        const schema = context === "form" ? scanForm(el) : { type: "object", properties: {} };

        registerWebMCPTool({
          name: toolName,
          description: generateDescription(el, context),
          inputSchema: schema,
          handler,
        });
      }
    }

    log(`📦 Scan complete: ${registeredTools.size} tools registered`);
  }

  // ── Watch for DOM changes ─────────────────────────────────────────────────

  let observer = null;

  function startWatching() {
    if (!config.watch) return;
    if (typeof MutationObserver === "undefined") return;

    let debounceTimer = null;

    observer = new MutationObserver(() => {
      // Debounce — don't re-scan on every tiny DOM change
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        log("🔄 DOM changed, re-scanning...");
        scan();
      }, 1000);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    log("👁️ Watching for DOM changes");
  }

  function stopWatching() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function getTools() {
    return Array.from(registeredTools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
    }));
  }

  function getToolManifest() {
    // Generate a .well-known/webmcp-style manifest
    return {
      version: "0.1.0",
      site: window.location.origin,
      generatedAt: new Date().toISOString(),
      generatedBy: "webmcp-auto",
      tools: getTools(),
    };
  }

  function destroy() {
    stopWatching();
    const mc = getModelContext();
    if (mc && mc.clearTools) {
      mc.clearTools();
    }
    registeredTools.clear();
    toolCount = 0;
    log("🗑️ All tools unregistered");
  }

  // ── Initialize ────────────────────────────────────────────────────────────

  // Wait for DOM to be ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      scan();
      startWatching();
    });
  } else {
    scan();
    startWatching();
  }

  return {
    scan,          // Manually trigger a re-scan
    getTools,      // Get all registered tools
    getToolManifest, // Get manifest JSON
    destroy,       // Unregister everything
    stopWatching,  // Stop DOM observer
  };
}

// ─── Auto-init when loaded as a script tag ────────────────────────────────────

if (typeof window !== "undefined") {
  // Check for data attributes on the script tag for configuration
  const currentScript = document.currentScript;
  if (currentScript) {
    const autoInit = currentScript.getAttribute("data-auto") !== "false";
    if (autoInit) {
      const config = {};
      if (currentScript.getAttribute("data-prefix")) {
        config.prefix = currentScript.getAttribute("data-prefix");
      }
      if (currentScript.getAttribute("data-exclude")) {
        config.exclude = currentScript.getAttribute("data-exclude").split(",");
      }
      if (currentScript.getAttribute("data-max-tools")) {
        config.maxTools = parseInt(currentScript.getAttribute("data-max-tools"), 10);
      }
      if (currentScript.getAttribute("data-debug") === "false") {
        config.debug = false;
      }

      window.__webmcpAuto = instrument(config);
    }
  }
}

export default instrument;
