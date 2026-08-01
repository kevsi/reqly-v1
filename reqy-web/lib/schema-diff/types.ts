export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  format?: string;
  nullable?: boolean;
}

export type FieldChangeKind = "added" | "removed" | "type-changed" | "type-changed:null";

export interface FieldChange {
  path: string;
  kind: FieldChangeKind;
  from?: string;
  to?: string;
}
