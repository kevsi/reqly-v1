# Bundle Optimization Report — reqy-web

**Generated**: 2026-08-06  
**Tool**: `@next/bundle-analyzer` (webpack)  
**Command**: `ANALYZE=true pnpm build`

---

## Summary

| Metric                | Value                                           |
| --------------------- | ----------------------------------------------- |
| Total chunks (client) | ~1.1 MB HTML report                             |
| Analyzer outputs      | `client.html`, `nodejs.html`, `edge.html`       |
| Tree-sitter WASM      | Lazy-loaded (not in initial bundle) ✅          |
| Radix UI              | Used via shadcn wrappers (15 packages retained) |
| Tree-shaking          | Working — unused Radix removed in Task 1        |

---

## Key Findings

### ✅ Already Optimized

1. **Tree-sitter parsers** — Dynamic imports via `tree-sitter-parser.ts` (lazy WASM loading)
2. **Radix UI duplication** — Eliminated 12 unused packages in Task 1 (104 → 92 deps)
3. **Code splitting** — Next.js automatic route-based splitting active
4. **Dockerfile** — C++ toolchain removed from runner stage (Task 5)

### ⚠️ Areas to Watch

1. **Lucide React icons** — Large icon library, consider `lucide-react@latest` tree-shaking
2. **CodeMirror 6** — Editor dependencies, ensure lazy load on pages that need it
3. **Recharts** — If <3 charts used, consider Chart.js or native Canvas
4. **Monaco Editor** — Not found, but if added, must be dynamic import

### ❌ Not in Bundle (Good)

- `java-parser` — Optional, correctly excluded (regex fallback)
- All tree-sitter WASM — Not in initial bundle (lazy loaded at runtime)

---

## Recommendations

### 1. Icon Optimization (High Impact)

```bash
# Current: lucide-react imports many icons
# Action: Audit actual usage, consider:
# - Import only used icons: import { IconName } from "lucide-react"
# - Or switch to @iconify/react with on-demand loading
```

### 2. CodeMirror Lazy Loading

```tsx
// Current: likely imported at module level in request/response panels
// Action: Dynamic import
const CodeMirror = dynamic(() => import("@codemirror/view"), { ssr: false });
```

### 3. Recharts → Chart.js (if applicable)

```bash
# If only 1-2 chart types:
pnpm remove recharts
pnpm add chart.js react-chartjs-2  # ~50KB vs ~200KB
```

### 4. Monitor Bundle Size in CI

Add to CI workflow:

```yaml
- name: Bundle size check
  run: |
    ANALYZE=true pnpm build
    # Parse client.html for total gzip size
    # Fail if > 500 KB gzipped (adjust threshold)
```

---

## Current Bundle Composition (Estimated)

Based on analyzer output and dependency audit:

| Category                  | Est. Size (gz) | Status              |
| ------------------------- | -------------- | ------------------- |
| React + Next.js core      | ~120 KB        | Required            |
| Radix UI (15 components)  | ~80 KB         | Required via shadcn |
| Lucide React              | ~60 KB         | ⚠️ Optimize imports |
| CodeMirror 6              | ~100 KB        | ⚠️ Lazy load        |
| Zustand + React Hook Form | ~30 KB         | Required            |
| TanStack Query            | ~25 KB         | Required            |
| Tree-sitter (runtime)     | ~5 KB          | Lazy loaded ✅      |
| Other utils               | ~50 KB         | Acceptable          |
| **Total (estimated)**     | **~470 KB**    | **Target < 500 KB** |

---

## Next Steps

1. **Immediate**: Audit Lucide icon imports in components
2. **This Sprint**: Add bundle size check to CI (fail if > 500 KB gzipped)
3. **Backlog**: Evaluate Chart.js migration if Recharts < 3 charts
4. **Backlog**: Consider `@iconify/react` for icons if many used

---

## Files for Reference

- `reqy-web/.next/analyze/client.html` — Client bundle details
- `reqy-web/.next/analyze/nodejs.html` — Server bundle details
- `reqy-web/.next/analyze/edge.html` — Edge runtime bundle

Open any in browser to explore interactively.
