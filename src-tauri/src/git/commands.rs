use std::path::{Path, PathBuf};
use std::cell::RefCell;
use std::sync::{Arc, Mutex};

use tauri::State;
use git2::{AnnotatedCommit, Repository, DiffOptions, StatusOptions, Signature};

use crate::error::AppError;
use crate::git::types::*;

/// État partagé pour connaître le chemin du repo courant et le répertoire de base autorisé.
pub struct GitRepoState {
    pub repo_dir: Arc<Mutex<Option<PathBuf>>>,
    pub workspace_dir: Arc<Mutex<Option<PathBuf>>>,
}

impl GitRepoState {
    pub fn new() -> Self {
        GitRepoState {
            repo_dir: Arc::new(Mutex::new(None)),
            workspace_dir: Arc::new(Mutex::new(None)),
        }
    }

    pub fn set_path(&self, path: PathBuf) -> Result<(), AppError> {
        *self.repo_dir.lock().map_err(|e| AppError::Internal(e.to_string()))? = Some(path);
        Ok(())
    }

    pub fn get_path(&self) -> Result<Option<PathBuf>, AppError> {
        self.repo_dir.lock().map_err(|e| AppError::Internal(e.to_string())).map(|g| g.clone())
    }

    pub fn set_workspace_dir(&self, path: PathBuf) -> Result<(), AppError> {
        *self.workspace_dir.lock().map_err(|e| AppError::Internal(e.to_string()))? = Some(path);
        Ok(())
    }

    pub fn get_workspace_dir(&self) -> Result<Option<PathBuf>, AppError> {
        self.workspace_dir.lock().map_err(|e| AppError::Internal(e.to_string())).map(|g| g.clone())
    }

    pub fn open_repo(&self) -> Result<Repository, AppError> {
        let path = self.get_path()?
            .ok_or_else(|| AppError::InvalidInput("No git repository initialized".into()))?;
        Repository::open(&path)
            .map_err(|e| AppError::Internal(format!("Failed to open repo: {}", e)))
    }
}

/// Validate that a URL uses an allowed scheme (http or https only).
fn validate_url_scheme(url: &str) -> Result<(), AppError> {
    let trimmed = url.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!(
            "URL scheme not allowed: {}. Only http:// and https:// are permitted.", url
        )))
    }
}

/// Check if a path resides in a system directory that must not be used for git repos.
fn is_system_directory(path: &Path) -> bool {
    let canonical = match std::fs::canonicalize(path) {
        Ok(p) => p,
        Err(_) => return false,
    };
    let s = canonical.to_string_lossy().to_lowercase();
    // Windows
    s.starts_with(r"c:\windows")
        || s.starts_with(r"c:\program files")
        || s.starts_with(r"c:\program files (x86)")
        || s.starts_with(r"c:\programdata")
        // Unix
        || s.starts_with("/etc")
        || s.starts_with("/usr")
        || s.starts_with("/bin")
        || s.starts_with("/sbin")
        || s.starts_with("/boot")
        || s.starts_with("/dev")
        || s.starts_with("/proc")
        || s.starts_with("/sys")
        // SSH config directory
        || s.contains("\\.ssh\\")
        || s.contains("/.ssh/")
}

/// Check if a path is contained within a base directory.
fn is_within_base(path: &Path, base: &Path) -> bool {
    let canonical_path = match std::fs::canonicalize(path) {
        Ok(p) => p,
        Err(_) => return false,
    };
    let canonical_base = match std::fs::canonicalize(base) {
        Ok(p) => p,
        Err(_) => return false,
    };
    canonical_path.starts_with(&canonical_base)
}

/// Check whether a path points to a valid git repository.
fn is_valid_git_repo(path: &Path) -> bool {
    Repository::open(path).is_ok()
}

#[tauri::command]
pub async fn git_init(
    path: String,
    state: State<'_, GitRepoState>,
) -> Result<(), AppError> {
    let repo_path = PathBuf::from(&path);

    if is_system_directory(&repo_path) {
        return Err(AppError::InvalidInput(format!(
            "Path '{}' is in a system directory and cannot be used for a git repository.", path
        )));
    }

    if let Some(ref workspace) = *state.workspace_dir.lock().map_err(|e| AppError::Internal(e.to_string()))? {
        if !is_within_base(&repo_path, workspace) {
            return Err(AppError::InvalidInput(format!(
                "Path '{}' must be within the workspace directory '{}'.", path, workspace.display()
            )));
        }
    }

    Repository::init(&repo_path)
        .map_err(|e| AppError::Internal(format!("git init failed: {}", e)))?;
    state.set_path(repo_path)?;
    Ok(())
}

#[tauri::command]
pub async fn git_open(
    path: String,
    state: State<'_, GitRepoState>,
) -> Result<(), AppError> {
    let repo_path = PathBuf::from(&path);
    // Validate by trying to open
    Repository::open(&repo_path)
        .map_err(|e| AppError::InvalidInput(format!("Cannot open repo at {path}: {e}")))?;
    state.set_path(repo_path)?;
    Ok(())
}

#[tauri::command]
pub async fn git_status(
    state: State<'_, GitRepoState>,
) -> Result<Vec<FileStatus>, AppError> {
    let repo = state.open_repo()?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true);

    let statuses = repo.statuses(Some(&mut opts))
        .map_err(|e| AppError::Internal(format!("git status failed: {}", e)))?;

    let mut result = Vec::new();
    for entry in statuses.iter() {
        let filepath = entry.path().unwrap_or("").to_string();
        let flags = entry.status();
        result.push(FileStatus {
            filepath,
            head: if flags.contains(git2::Status::INDEX_NEW) { 0 } else { 1 },
            workdir: if flags.intersects(git2::Status::WT_MODIFIED | git2::Status::WT_NEW | git2::Status::WT_DELETED) { 2 } else { 1 },
            staged: if flags.intersects(git2::Status::INDEX_NEW | git2::Status::INDEX_MODIFIED | git2::Status::INDEX_DELETED) { 2 } else { 1 },
        });
    }
    Ok(result)
}

#[tauri::command]
pub async fn git_log(
    max_count: Option<u32>,
    state: State<'_, GitRepoState>,
) -> Result<Vec<GitCommit>, AppError> {
    let repo = state.open_repo()?;
    let mut revwalk = repo.revwalk()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    revwalk.push_head()
        .map_err(|_| AppError::InvalidInput("No commits yet".into()))?;
    revwalk.set_sorting(git2::Sort::TIME)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let count = max_count.unwrap_or(50);
    let mut commits = Vec::new();

    for (_, oid) in revwalk.enumerate().take(count as usize) {
        let oid = oid.map_err(|e| AppError::Internal(e.to_string()))?;
        let commit = repo.find_commit(oid)
            .map_err(|e| AppError::Internal(e.to_string()))?;
        commits.push(GitCommit {
            oid: oid.to_string(),
            message: commit.message().unwrap_or("").to_string(),
            author: GitSignature {
                name: commit.author().name().unwrap_or("unknown").to_string(),
                email: commit.author().email().unwrap_or("unknown").to_string(),
            },
            committer: GitSignature {
                name: commit.committer().name().unwrap_or("unknown").to_string(),
                email: commit.committer().email().unwrap_or("unknown").to_string(),
            },
            timestamp: commit.time().seconds(),
        });
    }
    Ok(commits)
}

#[tauri::command]
pub async fn git_commit(
    message: String,
    author_name: Option<String>,
    author_email: Option<String>,
    state: State<'_, GitRepoState>,
) -> Result<String, AppError> {
    let repo = state.open_repo()?;
    let sig = Signature::now(
        &author_name.unwrap_or_else(|| "Reqly User".into()),
        &author_email.unwrap_or_else(|| "user@reqly.local".into()),
    ).map_err(|e| AppError::Internal(e.to_string()))?;

    let mut index = repo.index()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let tree_oid = index.write_tree()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let tree = repo.find_tree(tree_oid)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let parent_commit = match repo.head() {
        Ok(head) => {
            let oid = head.target()
                .ok_or_else(|| AppError::Internal("HEAD has no target".into()))?;
            Some(repo.find_commit(oid)
                .map_err(|e| AppError::Internal(e.to_string()))?)
        }
        Err(_) => None,
    };

    let parents: Vec<&git2::Commit> = parent_commit.iter().collect();
    let oid = repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        &message,
        &tree,
        &parents,
    ).map_err(|e| AppError::Internal(format!("git commit failed: {}", e)))?;

    Ok(oid.to_string())
}

#[tauri::command]
pub async fn git_stage(
    filepath: String,
    state: State<'_, GitRepoState>,
) -> Result<(), AppError> {
    let repo = state.open_repo()?;
    let mut index = repo.index()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    index.add_path(std::path::Path::new(&filepath))
        .map_err(|e| AppError::Internal(format!("Failed to stage {filepath}: {e}")))?;
    index.write()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn git_stage_all(
    state: State<'_, GitRepoState>,
) -> Result<(), AppError> {
    let repo = state.open_repo()?;
    let mut index = repo.index()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    index.add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
        .map_err(|e| AppError::Internal(format!("Failed to stage all: {e}")))?;
    index.write()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn git_unstage(
    filepath: String,
    state: State<'_, GitRepoState>,
) -> Result<(), AppError> {
    let repo = state.open_repo()?;
    let mut index = repo.index()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    index.remove_path(std::path::Path::new(&filepath))
        .map_err(|e| AppError::Internal(format!("Failed to unstage {filepath}: {e}")))?;
    index.write()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn git_diff(
    old_oid: String,
    new_oid: String,
    state: State<'_, GitRepoState>,
) -> Result<Vec<DiffFile>, AppError> {
    let repo = state.open_repo()?;

    let old_commit = repo.find_commit(
        git2::Oid::from_str(&old_oid).map_err(|_| AppError::InvalidInput("Invalid old_oid".into()))?
    ).map_err(|e| AppError::InvalidInput(format!("commit not found: {e}")))?;

    let new_tree = if new_oid == "WORKING" {
        let mut index = repo.index()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let tree_oid = index.write_tree()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        repo.find_tree(tree_oid)
            .map_err(|e| AppError::Internal(e.to_string()))?
    } else {
        let new_commit = repo.find_commit(
            git2::Oid::from_str(&new_oid).map_err(|_| AppError::InvalidInput("Invalid new_oid".into()))?
        ).map_err(|e| AppError::InvalidInput(format!("commit not found: {e}")))?;
        new_commit.tree().map_err(|e| AppError::Internal(e.to_string()))?
    };

    let old_tree = old_commit.tree()
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let diff = repo.diff_tree_to_tree(
        Some(&old_tree),
        Some(&new_tree),
        Some(&mut DiffOptions::new()),
    ).map_err(|e| AppError::Internal(e.to_string()))?;

    let files = RefCell::new(Vec::<DiffFile>::new());

    diff.foreach(
        &mut |delta, _| {
            let filepath = delta.new_file().path()
                .or_else(|| delta.old_file().path())
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            files.borrow_mut().push(DiffFile {
                filepath,
                hunks: Vec::new(),
            });
            true
        },
        None,
        Some(&mut |_delta, hunk: git2::DiffHunk<'_>| {
            if let Some(file) = files.borrow_mut().last_mut() {
                file.hunks.push(DiffHunk {
                    old_start: hunk.old_start(),
                    old_lines: hunk.old_lines(),
                    new_start: hunk.new_start(),
                    new_lines: hunk.new_lines(),
                    lines: Vec::new(),
                });
            }
            true
        }),
        Some(&mut |_delta, _hunk: Option<git2::DiffHunk<'_>>, line: git2::DiffLine<'_>| {
            if let Some(file) = files.borrow_mut().last_mut() {
                if let Some(hunk) = file.hunks.last_mut() {
                    hunk.lines.push(DiffLine {
                        origin: match line.origin() {
                            '+' => "add",
                            '-' => "delete",
                            _ => "context",
                        }.to_string(),
                        content: String::from_utf8_lossy(line.content()).to_string(),
                        old_lineno: line.old_lineno(),
                        new_lineno: line.new_lineno(),
                    });
                }
            }
            true
        }),
    ).map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(files.into_inner())
}

#[tauri::command]
pub async fn git_branch_list(
    state: State<'_, GitRepoState>,
) -> Result<Vec<BranchInfo>, AppError> {
    let repo = state.open_repo()?;
    let current_head = repo.head().ok();

    let mut branches = Vec::new();
    let branch_iter = repo.branches(None)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    for branch_result in branch_iter {
        let (branch, _kind) = branch_result
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let name = branch.name()
            .map_err(|e| AppError::Internal(e.to_string()))?
            .unwrap_or("unknown")
            .to_string();
        let oid = branch.get().target()
            .map(|o| o.to_string())
            .unwrap_or_default();
        let is_current = current_head.as_ref()
            .and_then(|h| h.shorthand())
            .map(|h| h == name)
            .unwrap_or(false);

        let (ahead, behind) = match branch.upstream() {
            Ok(upstream) => {
                let merge_base = repo.merge_base(
                    branch.get().target().ok_or_else(|| AppError::Internal("branch has no target".into()))?,
                    upstream.get().target().ok_or_else(|| AppError::Internal("branch has no target".into()))?,
                ).ok();
                match merge_base {
                    Some(base) => {
                        let a = repo.graph_ahead_behind(
                            branch.get().target().ok_or_else(|| AppError::Internal("branch has no target".into()))?,
                            base,
                        ).ok().unwrap_or((0, 0));
                        (a.0 as i32, a.1 as i32)
                    }
                    None => (0, 0),
                }
            }
            Err(_) => (0, 0),
        };

        branches.push(BranchInfo {
            name,
            is_current,
            oid,
            upstream: branch.upstream().ok()
                .and_then(|u| u.name().ok().flatten().map(|s| s.to_string())),
            ahead,
            behind,
        });
    }

    Ok(branches)
}

#[tauri::command]
pub async fn git_branch_create(
    name: String,
    from_oid: Option<String>,
    state: State<'_, GitRepoState>,
) -> Result<(), AppError> {
    let repo = state.open_repo()?;
    let target_oid = match from_oid {
        Some(oid_str) => git2::Oid::from_str(&oid_str)
            .map_err(|_| AppError::InvalidInput("Invalid OID".into()))?,
        None => repo.head()
            .map_err(|_| AppError::InvalidInput("No HEAD".into()))?
            .target()
            .ok_or_else(|| AppError::Internal("HEAD has no target".into()))?,
    };
    let commit = repo.find_commit(target_oid)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    repo.branch(&name, &commit, false)
        .map_err(|e| AppError::Internal(format!("Failed to create branch {name}: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn git_branch_delete(
    name: String,
    state: State<'_, GitRepoState>,
) -> Result<(), AppError> {
    let repo = state.open_repo()?;
    let mut branch = repo.find_branch(&name, git2::BranchType::Local)
        .map_err(|_| AppError::InvalidInput(format!("Branch {name} not found")))?;
    branch.delete()
        .map_err(|e| AppError::Internal(format!("Failed to delete branch {name}: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn git_branch_switch(
    name: String,
    state: State<'_, GitRepoState>,
) -> Result<(), AppError> {
    let repo = state.open_repo()?;
    let branch = repo.find_branch(&name, git2::BranchType::Local)
        .map_err(|_| AppError::InvalidInput(format!("Branch {name} not found")))?;
    let oid = branch.get().target()
        .ok_or_else(|| AppError::Internal("Branch has no target".into()))?;
    let commit = repo.find_commit(oid)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let tree = commit.tree()
        .map_err(|e| AppError::Internal(e.to_string()))?;

    repo.checkout_tree(tree.as_object(), None)
        .map_err(|e| AppError::Internal(format!("Checkout failed: {e}")))?;
    repo.set_head_bytes(format!("refs/heads/{name}").as_bytes())
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn git_remote_list(
    state: State<'_, GitRepoState>,
) -> Result<Vec<RemoteInfo>, AppError> {
    let repo = state.open_repo()?;
    let mut remotes = Vec::new();
    for name_result in repo.remotes()
        .map_err(|e| AppError::Internal(e.to_string()))?.iter() {
        let name = name_result
            .ok_or_else(|| AppError::Internal("Invalid remote name".into()))?
            .to_string();
        let url = repo.find_remote(&name)
            .map_err(|e| AppError::Internal(e.to_string()))?
            .url()
            .unwrap_or("")
            .to_string();
        remotes.push(RemoteInfo { name, url });
    }
    Ok(remotes)
}

#[tauri::command]
pub async fn git_remote_add(
    name: String,
    url: String,
    state: State<'_, GitRepoState>,
) -> Result<(), AppError> {
    validate_url_scheme(&url)?;
    let repo = state.open_repo()?;
    repo.remote(&name, &url)
        .map_err(|e| AppError::Internal(format!("Failed to add remote {name}: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn git_remote_remove(
    name: String,
    state: State<'_, GitRepoState>,
) -> Result<(), AppError> {
    let repo = state.open_repo()?;
    repo.remote_delete(&name)
        .map_err(|e| AppError::Internal(format!("Failed to delete remote {name}: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn git_push(
    remote: String,
    branch: String,
    state: State<'_, GitRepoState>,
) -> Result<(), AppError> {
    let repo = state.open_repo()?;
    let mut remote_obj = repo.find_remote(&remote)
        .map_err(|_| AppError::InvalidInput(format!("Remote {remote} not found")))?;

    let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");
    remote_obj.push(&[&refspec], None)
        .map_err(|e| push_error(e))?;
    Ok(())
}

#[tauri::command]
pub async fn git_ls_remote(
    url: String,
    state: State<'_, GitRepoState>,
) -> Result<Vec<String>, AppError> {
    let repo = state.open_repo()?;
    let mut remote = repo.remote_anonymous(&url)
        .map_err(|e| AppError::InvalidInput(format!("Invalid remote URL: {e}")))?;
    remote.connect(git2::Direction::Fetch)
        .map_err(|e| AppError::Network(format!("Cannot connect to {url}: {e}")))?;
    let refs = remote.list()
        .map_err(|e| AppError::Network(format!("Cannot list remote refs: {e}")))?;
    let mut branches: Vec<String> = Vec::new();
    for head in refs.iter() {
        let name = head.name();
        if let Some(stripped) = name.strip_prefix("refs/heads/") {
            branches.push(stripped.to_string());
        }
    }
    if branches.is_empty() {
        return Err(AppError::NotFound("No branches found on remote".into()));
    }
    Ok(branches)
}

#[tauri::command]
pub async fn git_push_force(
    remote: String,
    branch: String,
    state: State<'_, GitRepoState>,
) -> Result<(), AppError> {
    let repo = state.open_repo()?;
    let mut remote_obj = repo.find_remote(&remote)
        .map_err(|_| AppError::InvalidInput(format!("Remote {remote} not found")))?;

    let refspec = format!("+refs/heads/{branch}:refs/heads/{branch}");
    remote_obj.push(&[&refspec], None)
        .map_err(|e| AppError::Network(format!("Force push failed: {e}")))?;
    Ok(())
}

/// Map a `git2::Error` from a push to the most helpful `AppError` variant.
///
/// Non-fast-forward rejections get a dedicated, actionnable message that
/// tells the user *why* and *what to do* instead of a generic "Push failed".
fn push_error(e: git2::Error) -> AppError {
    if e.code() == git2::ErrorCode::NotFastForward {
        AppError::NonFastForward(
            "Push rejected (non-fast-forward). The remote branch has commits you don't have locally.\n\
             Suggestions:\n  \
             1. Fetch: click the cloud ↓ button to get the latest changes\n  \
             2. Rebase: git rebase origin/<branch>\n  \
             3. Or force push (⎇  click Push, or use Force Push) — this overwrites remote history"
                .into(),
        )
    } else {
        AppError::Network(format!("Push failed: {e}"))
    }
}

#[tauri::command]
pub async fn git_fetch(
    remote: String,
    state: State<'_, GitRepoState>,
) -> Result<(), AppError> {
    let repo = state.open_repo()?;
    let mut remote_obj = repo.find_remote(&remote)
        .map_err(|_| AppError::InvalidInput(format!("Remote {remote} not found")))?;
    let refspec = format!("+refs/heads/*:refs/remotes/{remote}/*");
    remote_obj.fetch(&[&refspec], None, None)
        .map_err(|e| AppError::Network(format!("Fetch failed: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn git_pull(
    remote: String,
    branch_name: String,
    state: State<'_, GitRepoState>,
) -> Result<(), AppError> {
    let repo = state.open_repo()?;

    // Fetch d'abord
    let mut remote_obj = repo.find_remote(&remote)
        .map_err(|_| AppError::InvalidInput(format!("Remote {remote} not found")))?;
    let refspec = format!("+refs/heads/{branch_name}:refs/remotes/{remote}/{branch_name}");
    remote_obj.fetch(&[&refspec], None, None)
        .map_err(|e| AppError::Network(format!("Fetch failed: {e}")))?;

    // Fast-forward merge: trouver le remote tracking branch et merger dans HEAD
    let remote_ref_name = format!("refs/remotes/{remote}/{branch_name}");
    let remote_branch = repo.find_reference(&remote_ref_name)
        .map_err(|e| AppError::InvalidInput(format!("Remote branch not found: {e}")))?;
    let remote_oid = remote_branch.target()
        .ok_or_else(|| AppError::Internal("Remote branch has no target".into()))?;
    let remote_commit = repo.find_commit(remote_oid)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let head = repo.head()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let head_oid = head.target()
        .ok_or_else(|| AppError::Internal("HEAD has no target".into()))?;

    if head_oid == remote_oid {
        return Ok(());
    }

    let merge_base = repo.merge_base(head_oid, remote_oid)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if merge_base == remote_oid {
        // Local branch already contains remote branch.
        return Ok(());
    }

    if merge_base == head_oid {
        // Fast-forward possible.
        let tree = remote_commit.tree()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        repo.checkout_tree(tree.as_object(), None)
            .map_err(|e| AppError::Internal(format!("Checkout failed: {e}")))?;
        repo.reference("HEAD", remote_oid, true, "pull: fast-forward")
            .map_err(|e| AppError::Internal(e.to_string()))?;
        return Ok(());
    }

    // Otherwise perform a merge commit.
    let head_commit = repo.find_commit(head_oid)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let annotated = repo.find_annotated_commit(remote_oid)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    repo.merge(&[&annotated], None, None)
        .map_err(|e| AppError::Internal(format!("Merge failed: {e}")))?;

    let mut index = repo.index()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    if index.has_conflicts() {
        return Err(AppError::InvalidInput(
            "Pull resulted in merge conflicts. Resolve conflicts in your working tree and commit manually.".into()
        ));
    }

    let tree_oid = index.write_tree()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let tree = repo.find_tree(tree_oid)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let sig = repo.signature()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let merge_message = format!(
        "Merge {} into {}",
        remote_ref_name,
        head.shorthand().unwrap_or("HEAD"),
    );

    repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        &merge_message,
        &tree,
        &[&head_commit, &remote_commit],
    ).map_err(|e| AppError::Internal(e.to_string()))?;

    repo.checkout_head(None)
        .map_err(|e| AppError::Internal(format!("Checkout failed: {e}")))?;
    repo.cleanup_state().ok();

    Ok(())
}

#[tauri::command]
pub async fn git_clone(
    url: String,
    dest_path: String,
    state: State<'_, GitRepoState>,
) -> Result<(), AppError> {
    validate_url_scheme(&url)?;

    let dest = PathBuf::from(&dest_path);

    if let Some(ref workspace) = *state.workspace_dir.lock().map_err(|e| AppError::Internal(e.to_string()))? {
        if !is_within_base(&dest, workspace) {
            return Err(AppError::InvalidInput(format!(
                "Destination path '{}' must be within the workspace directory '{}'.", dest_path, workspace.display()
            )));
        }
    }

    let _repo = Repository::clone(&url, &dest_path)
        .map_err(|e| AppError::Network(format!("Clone failed: {e}")))?;
    state.set_path(dest)?;
    Ok(())
}

#[tauri::command]
pub async fn git_write_collection_file(
    name: String,
    id: String,
    content: String,
    repo_dir: String,
) -> Result<(), AppError> {
    let collections_dir = PathBuf::from(&repo_dir).join("collections");
    std::fs::create_dir_all(&collections_dir)
        .map_err(|e| AppError::Internal(format!("Failed to create dir: {e}")))?;
    let safe_name = name.replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "_");
    let filepath = collections_dir.join(format!("{}_{}.json", safe_name, id));
    std::fs::write(&filepath, content)
        .map_err(|e| AppError::Internal(format!("Failed to write {filepath:?}: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn git_sync_collections(
    collections_json: String,
    repo_dir: String,
    state: State<'_, GitRepoState>,
) -> Result<(), AppError> {
    let repo_path = PathBuf::from(&repo_dir);

    if !is_valid_git_repo(&repo_path) {
        return Err(AppError::InvalidInput(format!(
            "Path '{}' is not a valid git repository.", repo_dir
        )));
    }

    if let Some(ref workspace) = *state.workspace_dir.lock().map_err(|e| AppError::Internal(e.to_string()))? {
        if !is_within_base(&repo_path, workspace) {
            return Err(AppError::InvalidInput(format!(
                "Repository path '{}' must be within the workspace directory '{}'.",
                repo_dir, workspace.display()
            )));
        }
    }

    // Écrire les collections sur le filesystem
    let collections_dir = PathBuf::from(&repo_dir).join("collections");
    std::fs::create_dir_all(&collections_dir)
        .map_err(|e| AppError::Internal(format!("Failed to create dir: {e}")))?;

    // Supprimer les anciens fichiers
    if let Ok(entries) = std::fs::read_dir(&collections_dir) {
        for entry in entries.flatten() {
            if entry.path().extension().map(|e| e == "json").unwrap_or(false) {
                std::fs::remove_file(entry.path()).ok();
            }
        }
    }

    // Écrire chaque collection comme fichier JSON
    let collections: Vec<serde_json::Value> = serde_json::from_str(&collections_json)
        .map_err(|e| AppError::InvalidInput(format!("Invalid collections JSON: {e}")))?;

    for col in &collections {
        let name = col["name"].as_str().unwrap_or("unnamed");
        let id = col["id"].as_str().unwrap_or("unknown");
        let safe_name = name.replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "_");
        let filepath = collections_dir.join(format!("{}_{}.json", safe_name, id));
        let content = serde_json::to_string_pretty(col)
            .map_err(|e| AppError::Internal(e.to_string()))?;
        std::fs::write(&filepath, content)
            .map_err(|e| AppError::Internal(format!("Failed to write {filepath:?}: {e}")))?;
    }

    Ok(())
}
