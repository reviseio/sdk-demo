import { useEffect, useMemo, useState } from "react";
import type { ReviseEditorHandle } from "@reviseio/sdk";

/**
 * A Swagger-style console over the agent tool surface: pick any of the tools
 * the SDK would hand your model, fill a form generated from its JSON schema,
 * and run it against the document in this tab. No backend involved — with
 * direct mode off, every mutation lands as a tracked change.
 */

type JsonSchema = {
  type?: string | string[];
  description?: string;
  enum?: Array<string | number>;
  default?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
};

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
};

const HIDDEN_DEMO_TOOLS = new Set(["revise_run_agent"]);

function primaryType(schema: JsonSchema): string {
  const t = schema.type;
  if (Array.isArray(t)) return t.find((x) => x !== "null") ?? "string";
  return t ?? (schema.enum ? "string" : "object");
}
function typeLabel(schema: JsonSchema): string {
  if (schema.enum) return schema.enum.map(String).join(" | ");
  const t = primaryType(schema);
  if (t === "array" && schema.items) return `${primaryType(schema.items)}[]`;
  return t;
}

/** Draft values are strings (form inputs); parse per-schema on submit. */
function parseField(
  schema: JsonSchema,
  raw: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const t = primaryType(schema);
  if (raw.trim() === "") return { ok: true, value: undefined };
  if (t === "number" || t === "integer") {
    const n = Number(raw);
    if (Number.isNaN(n)) return { ok: false, error: "not a number" };
    if (t === "integer" && !Number.isInteger(n))
      return { ok: false, error: "not an integer" };
    return { ok: true, value: n };
  }
  if (t === "array" || t === "object") {
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch {
      return { ok: false, error: "invalid JSON" };
    }
  }
  return { ok: true, value: raw };
}

function placeholderFor(schema: JsonSchema): string {
  const t = primaryType(schema);
  if (t === "array") {
    const inner = schema.items ? primaryType(schema.items) : "…";
    return inner === "object" ? '[{ … }, { … }]' : '["…", "…"]';
  }
  if (t === "object") return "{ … }";
  return "";
}

type RunResult = {
  name: string;
  success: boolean;
  agentFeedback?: string;
  error?: string;
  output?: unknown;
  durationMs: number;
};

export function ToolConsole({
  handle,
  onNotice,
}: {
  handle: ReviseEditorHandle | null;
  onNotice: (message: string) => void;
}) {
  const definitions = useMemo(
    () =>
      handle
        ? (handle.getToolDefinitions() as ToolDefinition[]).filter(
            (definition) => !HIDDEN_DEMO_TOOLS.has(definition.name),
          )
        : [],
    [handle],
  );

  const [toolName, setToolName] = useState<string>("");
  const [directMode, setDirectMode] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);

  const tool = definitions.find((d) => d.name === toolName) ?? null;
  const properties = tool?.inputSchema?.properties ?? {};
  const required = new Set(tool?.inputSchema?.required ?? []);

  // Reset the form (with schema defaults) when the tool changes.
  useEffect(() => {
    if (!tool) return;
    const next: Record<string, string> = {};
    for (const [key, schema] of Object.entries(
      tool.inputSchema?.properties ?? {},
    )) {
      if (schema.default !== undefined) {
        next[key] =
          typeof schema.default === "string"
            ? schema.default
            : JSON.stringify(schema.default);
      }
    }
    setDrafts(next);
    setErrors({});
    setResult(null);
  }, [toolName]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    if (!handle || !tool) return;
    const input: Record<string, unknown> = {};
    const nextErrors: Record<string, string> = {};
    for (const [key, schema] of Object.entries(properties)) {
      const raw = drafts[key] ?? "";
      const parsed = parseField(schema, raw);
      if (!parsed.ok) {
        nextErrors[key] = parsed.error;
        continue;
      }
      if (parsed.value === undefined) {
        if (required.has(key)) nextErrors[key] = "required";
        continue;
      }
      input[key] = parsed.value;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setRunning(true);
    const startedAt = performance.now();
    try {
      const outcome = (await handle.tools.execute(tool.name, input, {
        ...(directMode ? { directMode: true } : {}),
      })) as {
        success?: boolean;
        error?: string;
        agentFeedback?: string;
        output?: unknown;
      };
      setResult({
        name: tool.name,
        success: outcome.success !== false,
        agentFeedback: outcome.agentFeedback,
        error: outcome.error,
        output: outcome.output,
        durationMs: performance.now() - startedAt,
      });
    } catch (error) {
      // A role can refuse a tool outright — that arrives as a thrown
      // ReviseRoleError rather than a failed result.
      const message = error instanceof Error ? error.message : String(error);
      setResult({
        name: tool.name,
        success: false,
        error: message,
        durationMs: performance.now() - startedAt,
      });
      onNotice(message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <span>{definitions.length} tools available</span>
        <label className="direct" title="Apply mutations directly instead of as tracked changes">
          <input
            type="checkbox"
            checked={directMode}
            onChange={(event) => setDirectMode(event.target.checked)}
          />
          direct mode
        </label>
      </div>

      <div className="tool-picker-row">
        <select
          className="tool-picker"
          value={toolName}
          disabled={!handle}
          onChange={(event) => setToolName(event.target.value)}
        >
          <option value="">Choose a tool…</option>
          {definitions.map((definition) => (
            <option key={definition.name} value={definition.name}>
              {definition.name}
            </option>
          ))}
        </select>
      </div>

      {tool ? (
        <>
          <p className="tool-desc">{tool.description}</p>
          <div className="tool-form">
            {Object.entries(properties).map(([key, schema]) => {
              const error = errors[key];
              const t = primaryType(schema);
              const long = t === "array" || t === "object";
              return (
                <div
                  key={key}
                  className={error ? "tool-field invalid" : "tool-field"}
                >
                  <label>
                    <strong>{key}</strong>
                    {required.has(key) ? <span className="req">*</span> : null}
                    <span className="field-type">{typeLabel(schema)}</span>
                    {error ? <span className="req">{error}</span> : null}
                  </label>
                  {schema.enum ? (
                    <select
                      value={drafts[key] ?? ""}
                      onChange={(event) =>
                        setDrafts((d) => ({ ...d, [key]: event.target.value }))
                      }
                    >
                      <option value="">—</option>
                      {schema.enum.map((option) => (
                        <option key={String(option)} value={String(option)}>
                          {String(option)}
                        </option>
                      ))}
                    </select>
                  ) : t === "boolean" ? (
                    <select
                      value={drafts[key] ?? ""}
                      onChange={(event) =>
                        setDrafts((d) => ({ ...d, [key]: event.target.value }))
                      }
                    >
                      <option value="">—</option>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : long ? (
                    <textarea
                      value={drafts[key] ?? ""}
                      placeholder={placeholderFor(schema)}
                      spellCheck={false}
                      onChange={(event) =>
                        setDrafts((d) => ({ ...d, [key]: event.target.value }))
                      }
                    />
                  ) : (
                    <input
                      type={t === "number" || t === "integer" ? "number" : "text"}
                      value={drafts[key] ?? ""}
                      onChange={(event) =>
                        setDrafts((d) => ({ ...d, [key]: event.target.value }))
                      }
                    />
                  )}
                  {schema.description ? (
                    <p className="field-help">{schema.description}</p>
                  ) : null}
                </div>
              );
            })}
            <button
              className="tool-run"
              disabled={!handle || running}
              onClick={() => void run()}
            >
              {running ? "Running…" : "Run"}
            </button>
          </div>
        </>
      ) : (
        <p className="hint pad">
          These are the exact JSON-schema tools you would hand your model —
          the form above is generated from each tool&rsquo;s inputSchema.
          Nothing here calls a server: tools execute against the document in
          this tab, and with direct mode off every mutation lands as a
          tracked change. Tip: grab block IDs from the Selection panel.
        </p>
      )}

      {result ? (
        <div className="tool-result">
          <div className="tool-result-head">
            <code>{result.name}</code>
            <span className={result.success ? "status-pill ok" : "status-pill bad"}>
              {result.success ? "ok" : "failed"}
            </span>
            <span className="stat">{Math.round(result.durationMs)} ms</span>
          </div>
          {result.error ? (
            <p className="tool-feedback" style={{ color: "var(--del)" }}>
              {result.error}
            </p>
          ) : null}
          {result.agentFeedback ? (
            <p className="tool-feedback">{result.agentFeedback}</p>
          ) : null}
          {result.output !== undefined ? (
            <pre className="tool-output">
              {JSON.stringify(result.output, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
