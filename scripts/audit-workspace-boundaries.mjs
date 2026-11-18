#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditWorkspaceBoundaries,
  formatAuditResult,
} from "./lib/workspace-boundary-audit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = auditWorkspaceBoundaries(root);
console.log(formatAuditResult(result));
process.exitCode = result.violations.length === 0 ? 0 : 1;
