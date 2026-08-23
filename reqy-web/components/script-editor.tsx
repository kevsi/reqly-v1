"use client";

import dynamic from "next/dynamic";

// The whole CodeMirror stack (editor core, JS language, autocomplete) lives in
// script-editor-body and is only fetched when the Scripts section is expanded.
const ScriptCodeMirror = dynamic(() => import("./script-editor-body"), {
  ssr: false,
  loading: () => null,
});

interface Props {
  preRequestScript?: string;
  postResponseScript?: string;
  onPreChange: (next: string) => void;
  onPostChange: (next: string) => void;
}

export function ScriptEditor({
  preRequestScript,
  postResponseScript,
  onPreChange,
  onPostChange,
}: Props) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
          Pre-request script (JS, sandboxed)
        </label>
        <ScriptCodeMirror
          value={preRequestScript ?? ""}
          onChange={onPreChange}
          placeholder="// pm.environment.set('token', 'abc123')"
          ariaLabel="Pre-request script (JS, sandboxed)"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
          Post-response script (JS, sandboxed)
        </label>
        <ScriptCodeMirror
          value={postResponseScript ?? ""}
          onChange={onPostChange}
          placeholder="// pm.expect(pm.response.code).to.equal(200)"
          ariaLabel="Post-response script (JS, sandboxed)"
        />
      </div>
    </div>
  );
}
