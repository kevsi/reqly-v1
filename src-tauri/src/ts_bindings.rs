//! TypeScript binding generator — [`ts-rs`](https://crates.io/crates/ts-rs) bridge.
//!
//! Every `#[ts(export)]` struct automatically generates a `.ts` file during
//! compilation. This module re-exports them so the compiler sees all types
//! and generates their bindings.
//!
//! ## Generate
//!
//! ```sh
//! TS_RS_EXPORT_DIR=../reqy-web/lib/generated cargo build --features ts-export
//! ```
//!
//! ## Keeping generated files fresh
//!
//! ts-rs exports happen at compile time. The generated `.ts` files should be
//! committed to the repo so the TypeScript side needn't run the Rust build.
//! A CI check can verify they're up to date:
//!
//! ```sh
//! cargo build --features ts-export
//! git diff --exit-code ../reqy-web/lib/generated/
//! ```

// ── Re-export all IPC types so ts-rs sees them during compilation ───────

#[cfg(feature = "ts-export")]
pub use crate::capture::{CapturedRequest, CapturedSummary};
#[cfg(feature = "ts-export")]
pub use crate::fetch::{TauriCookie, TauriFetchResponse};
#[cfg(feature = "ts-export")]
pub use crate::git::types::{
    BranchInfo, DiffFile, DiffHunk, DiffLine, FileStatus, GitCommit, GitSignature, RemoteInfo,
};
#[cfg(feature = "ts-export")]
pub use crate::mcp::{McpServerConfig, McpServerStatus};
#[cfg(feature = "ts-export")]
pub use crate::store::QueuedRequest;
