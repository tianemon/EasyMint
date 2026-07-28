// Stubs for omp internal dependencies not needed by EM
export type SourceMeta = { name?: string; path?: string };
export type CustomTool = any;
export type LoadedCustomTool = any;
export type AgentStorage = any;
export type MCPServer = any;
export const mcpCapability = { loadConfig: () => ({}) };
export const loadCapability = () => ({});
export const invalidate = () => {};
export function CustomToolToDefinition(t: any): any { return t; }
export type { PathResolver } from "./types"; // circular but safe
