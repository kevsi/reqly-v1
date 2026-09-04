use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use git2::{
    Cred, DiffOptions, FetchOptions, PushOptions, RemoteCallbacks, Repository, Signature,
    StatusOptions,
};
use tauri::State;

use crate::error::{AppError, NetworkErrorKind};
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
        *self
            .repo_dir
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))? = Some(path);
        Ok(())
    }

    pub fn get_path(&self) -> Result<Option<PathBuf>, AppError> {
        self.repo_dir
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))
            .map(|g| g.clone())
    }

    pub fn set_workspace_dir(&self, path: PathBuf) -> Result<(), AppError> {
        *self
            .workspace_dir
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))? = Some(path);
        Ok(())
    }

    pub fn get_workspace_dir(&self) -> Result<Option<PathBuf>, AppError> {
        self.workspace_dir
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))
            .map(|g| g.clone())
    }

    pub fn open_repo(&self) -> Result<Repository, AppError> {
        let path = self
            .get_path()?
            .ok_or_else(|| AppError::InvalidInput("No git repository initialized".into()))?;
        Repository::open(&path)
            .map_err(|e| AppError::Internal(format!("Failed to open repo: {}", e)))
    }
}

/// Validate that a URL uses an allowed scheme (http or https only).
fn validate_url_scheme(url: &str) -> Result<(), AppError> {
    let trimmed = url.trim();
    match reqwest::Url::parse(trimmed) {
        Ok(parsed) => {
            let scheme = parsed.scheme();
            if scheme == "http" || scheme == "https" {
                Ok(())
            } else {
                Err(AppError::InvalidInput(format!(
                    "URL scheme not allowed: {}. Only http:// and https:// are permitted.",
                    scheme
                )))
            }
        }
        Err(_) => Err(AppError::InvalidInput(format!("Invalid URL: {}", trimmed))),
    }
}

/// `true` si l'IP appartient à un range privé/réservé (local, non routable).
fn is_private_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            let octets = v4.octets();
            v4.is_private()          // 10/8, 172.16/12, 192.168/16
                || v4.is_loopback()  // 127/8
                || v4.is_link_local()// 169.254/16 (y compris 169.254.169.254)
                || v4.is_unspecified()   // 0.0.0.0
                || v4.is_broadcast()     // 255.255.255.255
                || v4.is_documentation() // 192.0.2/24, 198.51.100/24, 203.0.113/24
                || octets[0] == 100      // 100.64/10 (CGNAT)
                || octets[0] == 198 && octets[1] == 18   // 198.18/15 (benchmarking)
                || octets[0] == 198 && octets[1] == 19
        }
        std::net::IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_unique_local()  // fc00::/7
                || v6.is_multicast()
                || v6.segments()[0] == 0xfe80 // fe80::/10 (link-local)
                // ::ffff:0:0/96 (IPv4 mappé) — vérifier l'IPv4 encapsulée
                || (v6.segments()[0..5].iter().all(|&s| s == 0)
                    && v6.segments()[5] == 0xffff)
        }
    }
}

/// `true` si le hostname est un nom réservé local (localhost, *.local, ...)
/// ou une IP privée littérale. N'effectue PAS de résolution DNS (l'appelant
/// décide si c'est nécessaire).
fn is_reserved_git_host(url: &reqwest::Url) -> bool {
    let host = match url.host_str() {
        Some(h) => h,
        None => return false,
    };
    let lower = host.to_ascii_lowercase();
    // Noms réservés / TLD internes
    if lower == "localhost"
        || lower.ends_with(".localhost")
        || lower.ends_with(".local")
        || lower.ends_with(".internal")
        || lower.ends_with(".lan")
        || lower.ends_with(".home")
        || lower.ends_with(".home.arpa")
        || lower.ends_with(".test")
        || lower.ends_with(".invalid")
        || lower.ends_with(".example")
    {
        return true;
    }
    // IP littérale
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        return is_private_ip(ip);
    }
    false
}

/// Valide un URL de dépôt : schéma http/https + hôte non privé.
/// `ALLOW_PRIVATE_GIT_HOSTS=true` est l'échappatoire pour les dépôts
/// auto-hébergés sur le réseau local.
fn validate_remote_url(url: &str) -> Result<(), AppError> {
    validate_url_scheme(url)?;
    if std::env::var("ALLOW_PRIVATE_GIT_HOSTS")
        .map(|v| v == "true")
        .unwrap_or(false)
    {
        return Ok(());
    }
    if let Ok(parsed) = reqwest::Url::parse(url.trim()) {
        if is_reserved_git_host(&parsed) {
            return Err(AppError::InvalidInput(format!(
                "URL de dépôt bloquée : l'hôte '{}' est privé ou réservé (localhost, IP interne). \
                 Utilisez une URL publique, ou définissez ALLOW_PRIVATE_GIT_HOSTS=true pour les dépôts \
                 auto-hébergés en réseau local.",
                parsed.host_str().unwrap_or("?")
            )));
        }
    }
    Ok(())
}

fn remote_callbacks(credentials: Option<GitCredentials>) -> RemoteCallbacks<'static> {
    let mut callbacks = RemoteCallbacks::new();
    if let Some(credentials) = credentials {
        callbacks.credentials(move |_url, username_from_url, _allowed| {
            let username = username_from_url.unwrap_or(&credentials.username);
            Cred::userpass_plaintext(username, &credentials.password)
        });
    }
    callbacks
}

/// Check if a path resides in a system directory that must not be used for git repos.
fn is_system_directory(path: &Path) -> bool {
    let canonical = match std::fs::canonicalize(path) {
        Ok(p) => p,
        Err(_) => return false,
    };
    let mut s = canonical.to_string_lossy().to_lowercase();
    // Windows `canonicalize` returns `\\?\C:\...` — strip the prefix so the
    // drive-letter checks below actually match.
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        s = stripped.to_string();
    }
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

fn validate_workspace_containment(path: &Path, state: &State<'_, GitRepoState>) -> Result<(), AppError> {
    if let Some(base) = state.get_workspace_dir()? {
        // Only enforce when the base exists on disk and the path can be canonicalized.
        if base.exists() && path.exists() && !is_within_base(path, &base) {
            return Err(AppError::InvalidInput(format!(
                "Path '{}' is outside the allowed workspace directory '{}'.",
                path.display(),
                base.display()
            )));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn git_init(path: String, state: State<'_, GitRepoState>) -> Result<(), AppError> {
    let repo_path = PathBuf::from(&path);

    if is_system_directory(&repo_path) {
        return Err(AppError::InvalidInput(format!(
            "Path '{}' is in a system directory and cannot be used for a git repository.",
            path
        )));
    }
    validate_workspace_containment(&repo_path, &state)?;

    Repository::init(&repo_path)
        .map_err(|e| AppError::Internal(format!("git init failed: {}", e)))?;
    state.set_path(repo_path)?;
    Ok(())
}

#[tauri::command]
pub async fn git_open(path: String, state: State<'_, GitRepoState>) -> Result<(), AppError> {
    let repo_path = PathBuf::from(&path);

    if is_system_directory(&repo_path) {
        return Err(AppError::InvalidInput(format!(
            "Path '{}' is in a system directory and cannot be used for a git repository.",
            path
        )));
    }
    validate_workspace_containment(&repo_path, &state)?;

    // Validate by trying to open
    Repository::open(&repo_path)
        .map_err(|e| AppError::InvalidInput(format!("Cannot open repo at {path}: {e}")))?;
    state.set_path(repo_path)?;
    Ok(())
}

#[tauri::command]
pub async fn git_status(state: State<'_, GitRepoState>) -> Result<Vec<FileStatus>, AppError> {
    let repo = state.open_repo()?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true);

    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| AppError::Internal(format!("git status failed: {}", e)))?;

    let mut result = Vec::new();
    for entry in statuses.iter() {
        let filepath = entry.path().unwrap_or("").to_string();
        let flags = entry.status();
        result.push(FileStatus {
            filepath,
            head: if flags.contains(git2::Status::INDEX_NEW) {
                0
            } else {
                1
            },
            workdir: if flags.intersects(
                git2::Status::WT_MODIFIED | git2::Status::WT_NEW | git2::Status::WT_DELETED,
            ) {
                2
            } else {
                1
            },
            staged: if flags.intersects(
                git2::Status::INDEX_NEW
                    | git2::Status::INDEX_MODIFIED
                    | git2::Status::INDEX_DELETED,
            ) {
                2
            } else {
                1
            },
            conflicted: flags.contains(git2::Status::CONFLICTED),
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
    let mut revwalk = repo
        .revwalk()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    revwalk
        .push_head()
        .map_err(|_| AppError::InvalidInput("No commits yet".into()))?;
    revwalk
        .set_sorting(git2::Sort::TIME)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let count = max_count.unwrap_or(50);
    let mut commits = Vec::new();

    for (_, oid) in revwalk.enumerate().take(count as usize) {
        let oid = oid.map_err(|e| AppError::Internal(e.to_string()))?;
        let commit = repo
            .find_commit(oid)
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
    )
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let mut index = repo
        .index()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let tree_oid = index
        .write_tree()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let tree = repo
        .find_tree(tree_oid)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let parent_commit = match repo.head() {
        Ok(head) => {
            let oid = head
                .target()
                .ok_or_else(|| AppError::Internal("HEAD has no target".into()))?;
            Some(
                repo.find_commit(oid)
                    .map_err(|e| AppError::Internal(e.to_string()))?,
            )
        }
        Err(_) => None,
    };

    let parents: Vec<&git2::Commit> = parent_commit.iter().collect();
    let oid = repo
        .commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)
        .map_err(|e| AppError::Internal(format!("git commit failed: {}", e)))?;

    Ok(oid.to_string())
}

#[tauri::command]
pub async fn git_stage(filepath: String, state: State<'_, GitRepoState>) -> Result<(), AppError> {
    let repo = state.open_repo()?;
    let mut index = repo
        .index()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    index
        .add_path(std::path::Path::new(&filepath))
        .map_err(|e| AppError::Internal(format!("Failed to stage {filepath}: {e}")))?;
    index
        .write()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn git_stage_all(state: State<'_, GitRepoState>) -> Result<(), AppError> {
    let repo = state.open_repo()?;
    let mut index = repo
        .index()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    index
        .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
        .map_err(|e| AppError::Internal(format!("Failed to stage all: {e}")))?;
    index
        .write()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn git_unstage(filepath: String, state: State<'_, GitRepoState>) -> Result<(), AppError> {
    let repo = state.open_repo()?;
    let mut index = repo
        .index()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    index
        .remove_path(std::path::Path::new(&filepath))
        .map_err(|e| AppError::Internal(format!("Failed to unstage {filepath}: {e}")))?;
    index
        .write()
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

    let old_commit = repo
        .find_commit(
            git2::Oid::from_str(&old_oid)
                .map_err(|_| AppError::InvalidInput("Invalid old_oid".into()))?,
        )
        .map_err(|e| AppError::InvalidInput(format!("commit not found: {e}")))?;

    let new_tree = if new_oid == "WORKING" {
        let mut index = repo
            .index()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let tree_oid = index
            .write_tree()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        repo.find_tree(tree_oid)
            .map_err(|e| AppError::Internal(e.to_string()))?
    } else {
        let new_commit = repo
            .find_commit(
                git2::Oid::from_str(&new_oid)
                    .map_err(|_| AppError::InvalidInput("Invalid new_oid".into()))?,
            )
            .map_err(|e| AppError::InvalidInput(format!("commit not found: {e}")))?;
        new_commit
            .tree()
            .map_err(|e| AppError::Internal(e.to_string()))?
    };

    let old_tree = old_commit
        .tree()
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let diff = repo
        .diff_tree_to_tree(
            Some(&old_tree),
            Some(&new_tree),
            Some(&mut DiffOptions::new()),
        )
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let files = RefCell::new(Vec::<DiffFile>::new());

    diff.foreach(
        &mut |delta, _| {
            let filepath = delta
                .new_file()
                .path()
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
        Some(
            &mut |_delta, _hunk: Option<git2::DiffHunk<'_>>, line: git2::DiffLine<'_>| {
                if let Some(file) = files.borrow_mut().last_mut() {
                    if let Some(hunk) = file.hunks.last_mut() {
                        hunk.lines.push(DiffLine {
                            origin: match line.origin() {
                                '+' => "add",
                                '-' => "delete",
                                _ => "context",
                            }
                            .to_string(),
                            content: String::from_utf8_lossy(line.content()).to_string(),
                            old_lineno: line.old_lineno(),
                            new_lineno: line.new_lineno(),
                        });
                    }
                }
                true
            },
        ),
    )
    .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(files.into_inner())
}

#[tauri::command]
pub async fn git_branch_list(state: State<'_, GitRepoState>) -> Result<Vec<BranchInfo>, AppError> {
    let repo = state.open_repo()?;
    let current_head = repo.head().ok();

    let mut branches = Vec::new();
    let branch_iter = repo
        .branches(None)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    for branch_result in branch_iter {
        let (branch, _kind) = branch_result.map_err(|e| AppError::Internal(e.to_string()))?;
        let name = branch
            .name()
            .map_err(|e| AppError::Internal(e.to_string()))?
            .unwrap_or("unknown")
            .to_string();
        let oid = branch
            .get()
            .target()
            .map(|o| o.to_string())
            .unwrap_or_default();
        let is_current = current_head
            .as_ref()
            .and_then(|h| h.shorthand())
            .map(|h| h == name)
            .unwrap_or(false);

        let (ahead, behind) = match branch.upstream() {
            Ok(upstream) => {
                let merge_base = repo
                    .merge_base(
                        branch
                            .get()
                            .target()
                            .ok_or_else(|| AppError::Internal("branch has no target".into()))?,
                        upstream
                            .get()
                            .target()
                            .ok_or_else(|| AppError::Internal("branch has no target".into()))?,
                    )
                    .ok();
                match merge_base {
                    Some(base) => {
                        let a = repo
                            .graph_ahead_behind(
                                branch.get().target().ok_or_else(|| {
                                    AppError::Internal("branch has no target".into())
                                })?,
                                base,
                            )
                            .ok()
                            .unwrap_or((0, 0));
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
            upstream: branch
                .upstream()
                .ok()
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
    validate_ref_name(&name, "Nom de branche")?;
    let repo = state.open_repo()?;
    let target_oid = match from_oid {
        Some(oid_str) => git2::Oid::from_str(&oid_str)
            .map_err(|_| AppError::InvalidInput("Invalid OID".into()))?,
        None => repo
            .head()
            .map_err(|_| AppError::InvalidInput("No HEAD".into()))?
            .target()
            .ok_or_else(|| AppError::Internal("HEAD has no target".into()))?,
    };
    let commit = repo
        .find_commit(target_oid)
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
    let mut branch = repo
        .find_branch(&name, git2::BranchType::Local)
        .map_err(|_| AppError::InvalidInput(format!("Branch {name} not found")))?;
    branch
        .delete()
        .map_err(|e| AppError::Internal(format!("Failed to delete branch {name}: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn git_branch_switch(
    name: String,
    state: State<'_, GitRepoState>,
) -> Result<(), AppError> {
    let repo = state.open_repo()?;
    let branch = repo
        .find_branch(&name, git2::BranchType::Local)
        .map_err(|_| AppError::InvalidInput(format!("Branch {name} not found")))?;
    let oid = branch
        .get()
        .target()
        .ok_or_else(|| AppError::Internal("Branch has no target".into()))?;
    let commit = repo
        .find_commit(oid)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let tree = commit
        .tree()
        .map_err(|e| AppError::Internal(e.to_string()))?;

    repo.checkout_tree(tree.as_object(), None)
        .map_err(|e| AppError::Internal(format!("Checkout failed: {e}")))?;
    repo.set_head_bytes(format!("refs/heads/{name}").as_bytes())
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn git_remote_list(state: State<'_, GitRepoState>) -> Result<Vec<RemoteInfo>, AppError> {
    let repo = state.open_repo()?;
    let mut remotes = Vec::new();
    for name_result in repo
        .remotes()
        .map_err(|e| AppError::Internal(e.to_string()))?
        .iter()
    {
        let name = name_result
            .ok_or_else(|| AppError::Internal("Invalid remote name".into()))?
            .to_string();
        let url = repo
            .find_remote(&name)
            .map_err(|e| AppError::Internal(e.to_string()))?
            .url()
            .unwrap_or("")
            .to_string();
        remotes.push(RemoteInfo { name, url });
    }
    Ok(remotes)
}

/// Valide un nom de remote/branche avant interpolation dans les refspecs :
/// seuls `[A-Za-z0-9._/-]` sont acceptés (anti-injection de refspec comme
/// `origin; rm -rf /` ou `foo refs/heads/bar`). Les remotes n'autorisent pas
/// `/` (règle git) — voir `validate_remote_name`.
fn validate_ref_name(name: &str, kind: &str) -> Result<(), AppError> {
    if name.is_empty() || name.len() > 100 {
        return Err(AppError::InvalidInput(format!(
            "{kind} invalide : nom vide ou trop long."
        )));
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '/'))
    {
        return Err(AppError::InvalidInput(format!(
            "{kind} invalide : seuls les caractères A-Z, a-z, 0-9, '.', '_', '-' et '/' sont autorisés."
        )));
    }
    // Règles git : pas de début par « - » (confusion d'option dans les
    // refspecs), pas de « .. », pas de fin en « .lock », « / » ou « . »
    if name.starts_with('-')
        || name.contains("..")
        || name.ends_with(".lock")
        || name.ends_with('/')
        || name.ends_with('.')
    {
        return Err(AppError::InvalidInput(format!(
            "{kind} invalide : début par '-', séquence '..', ou fin par '.lock', '/' ou '.' interdits."
        )));
    }
    Ok(())
}

/// Les noms de remote ne peuvent pas contenir de `/` (contrainte git).
fn validate_remote_name(name: &str) -> Result<(), AppError> {
    validate_ref_name(name, "Nom de remote")?;
    if name.contains('/') {
        return Err(AppError::InvalidInput(
            "Nom de remote invalide : le caractère '/' n'est pas autorisé.".into(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn git_remote_add(
    name: String,
    url: String,
    state: State<'_, GitRepoState>,
) -> Result<(), AppError> {
    validate_remote_name(&name)?;
    validate_remote_url(&url)?;
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
    credentials: Option<GitCredentials>,
    state: State<'_, GitRepoState>,
) -> Result<(), AppError> {
    validate_ref_name(&branch, "Nom de branche")?;
    let repo = state.open_repo()?;
    let mut remote_obj = repo
        .find_remote(&remote)
        .map_err(|_| AppError::InvalidInput(format!("Remote {remote} not found")))?;

    if let Some(remote_url) = remote_obj.url() {
        validate_remote_url(remote_url)?;
    }

    let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");
    let had_credentials = credentials.is_some();
    let callbacks = remote_callbacks(credentials);
    let mut push_options = PushOptions::new();
    push_options.remote_callbacks(callbacks);
    remote_obj
        .push(&[&refspec], Some(&mut push_options))
        .map_err(|e| {
            remote_op_error("L'envoi vers le dépôt distant a échoué", e, had_credentials)
        })?;
    Ok(())
}

#[tauri::command]
pub async fn git_ls_remote(
    url: String,
    state: State<'_, GitRepoState>,
) -> Result<Vec<String>, AppError> {
    validate_remote_url(&url)?;
    let repo = state.open_repo()?;
    let mut remote = repo
        .remote_anonymous(&url)
        .map_err(|e| AppError::InvalidInput(format!("Invalid remote URL: {e}")))?;
    remote
        .connect(git2::Direction::Fetch)
        .map_err(|e| remote_op_error("La connexion au dépôt distant a échoué", e, false))?;
    let refs = remote.list().map_err(|e| {
        remote_op_error(
            "La lecture des références du dépôt distant a échoué",
            e,
            false,
        )
    })?;
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
    credentials: Option<GitCredentials>,
    state: State<'_, GitRepoState>,
) -> Result<(), AppError> {
    validate_ref_name(&branch, "Nom de branche")?;
    let repo = state.open_repo()?;
    let mut remote_obj = repo
        .find_remote(&remote)
        .map_err(|_| AppError::InvalidInput(format!("Remote {remote} not found")))?;

    if let Some(remote_url) = remote_obj.url() {
        validate_remote_url(remote_url)?;
    }

    let refspec = format!("+refs/heads/{branch}:refs/heads/{branch}");
    let had_credentials = credentials.is_some();
    let callbacks = remote_callbacks(credentials);
    let mut push_options = PushOptions::new();
    push_options.remote_callbacks(callbacks);
    remote_obj
        .push(&[&refspec], Some(&mut push_options))
        .map_err(|e| {
            remote_op_error(
                "Le push forcé vers le dépôt distant a échoué",
                e,
                had_credentials,
            )
        })?;
    Ok(())
}

/// Classifie une erreur `git2::Error` d'opération distante (push/fetch/pull/
/// clone) en `AppError` avec un message français actionnable :
/// - non-fast-forward → message dédié (récupérer / rebaser / force push)
/// - 401/403 ou « could not read username » → authentification refusée, avec
///   une aide adaptée selon que des identifiants ont été fournis ou non
/// - 404 → dépôt introuvable
/// - sinon → message générique avec le détail technique conservé
fn remote_op_error(action: &str, e: git2::Error, had_credentials: bool) -> AppError {
    if e.code() == git2::ErrorCode::NotFastForward {
        return AppError::NonFastForward(
            "Push rejeté (non-fast-forward). La branche distante contient des commits que vous \
             n'avez pas en local.\nSuggestions :\n  1. Récupérer : cliquez sur la flèche vers le \
             bas (cloud ↓) pour obtenir les derniers changements\n  2. Rebaser : \
             git rebase origin/<branche>\n  3. Ou Force Push (icône ⚠ sur le remote) — écrase \
             l'historique distant"
                .into(),
        );
    }
    let lower = e.message().to_ascii_lowercase();
    let is_auth = lower.contains("authentication")
        || lower.contains("could not read username")
        || lower.contains("authorization failed")
        || lower.contains("invalid credentials")
        || lower.contains("terminal prompts disabled")
        || lower.contains("requested url returned error: 401")
        || lower.contains("requested url returned error: 403")
        || lower.contains("http 401")
        || lower.contains("http 403");
    let is_not_found = lower.contains("requested url returned error: 404")
        || lower.contains("repository not found")
        || lower.contains("404 not found");

    if is_auth {
        let hint = if had_credentials {
            "Les identifiants fournis sont invalides ou ont expiré. Reconnectez votre compte dans \
             Paramètres → Outils intégrés, ou vérifiez les scopes du token ('repo' pour GitHub)."
        } else {
            "Aucun identifiant n'a été trouvé. Connectez votre compte GitHub/GitLab dans \
             Paramètres → Outils intégrés : le token est utilisé automatiquement par Git, aucune \
             saisie n'est nécessaire sur la page Git."
        };
        AppError::network(
            NetworkErrorKind::Unknown,
            format!("{action} : l'authentification a été refusée par le dépôt distant."),
            format!("{hint}\nDétail technique : {e}"),
        )
    } else if is_not_found {
        AppError::network(
            NetworkErrorKind::Unknown,
            format!("{action} : dépôt distant introuvable ou accès refusé."),
            format!(
                "Vérifiez l'URL du remote et que votre compte a bien accès au dépôt.\nDétail technique : {e}"
            ),
        )
    } else {
        AppError::network(
            NetworkErrorKind::Unknown,
            format!("{action}."),
            format!(
                "Vérifiez votre connexion internet et l'URL du remote.\nDétail technique : {e}"
            ),
        )
    }
}

#[tauri::command]
pub async fn git_fetch(
    remote: String,
    credentials: Option<GitCredentials>,
    state: State<'_, GitRepoState>,
) -> Result<(), AppError> {
    let repo = state.open_repo()?;
    let mut remote_obj = repo
        .find_remote(&remote)
        .map_err(|_| AppError::InvalidInput(format!("Remote {remote} not found")))?;
    if let Some(remote_url) = remote_obj.url() {
        validate_remote_url(remote_url)?;
    }
    let refspec = format!("+refs/heads/*:refs/remotes/{remote}/*");
    let had_credentials = credentials.is_some();
    let callbacks = remote_callbacks(credentials);
    let mut fetch_options = FetchOptions::new();
    fetch_options.remote_callbacks(callbacks);
    remote_obj
        .fetch(&[&refspec], Some(&mut fetch_options), None)
        .map_err(|e| {
            remote_op_error(
                "La récupération depuis le dépôt distant a échoué",
                e,
                had_credentials,
            )
        })?;
    Ok(())
}

#[tauri::command]
pub async fn git_pull(
    remote: String,
    branch_name: String,
    credentials: Option<GitCredentials>,
    state: State<'_, GitRepoState>,
) -> Result<(), AppError> {
    let repo = state.open_repo()?;

    // Fetch d'abord
    let mut remote_obj = repo
        .find_remote(&remote)
        .map_err(|_| AppError::InvalidInput(format!("Remote {remote} not found")))?;
    if let Some(remote_url) = remote_obj.url() {
        validate_remote_url(remote_url)?;
    }
    let refspec = format!("+refs/heads/{branch_name}:refs/remotes/{remote}/{branch_name}");
    let had_credentials = credentials.is_some();
    let callbacks = remote_callbacks(credentials);
    let mut fetch_options = FetchOptions::new();
    fetch_options.remote_callbacks(callbacks);
    remote_obj
        .fetch(&[&refspec], Some(&mut fetch_options), None)
        .map_err(|e| {
            remote_op_error(
                "La récupération depuis le dépôt distant a échoué",
                e,
                had_credentials,
            )
        })?;

    // Fast-forward merge: trouver le remote tracking branch et merger dans HEAD
    let remote_ref_name = format!("refs/remotes/{remote}/{branch_name}");
    let remote_branch = match repo.find_reference(&remote_ref_name) {
        Ok(reference) => reference,
        Err(_) => {
            // Certains dépôts n'actualisent pas la référence de suivi après un
            // fetch libgit2. Recréer cette référence depuis la liste du remote
            // permet au pull de fonctionner même si origin/<branche> manque.
            remote_obj.connect(git2::Direction::Fetch).map_err(|e| {
                remote_op_error(
                    "La connexion à la branche distante a échoué",
                    e,
                    had_credentials,
                )
            })?;
            let remote_head = remote_obj
                .list()
                .map_err(|e| remote_op_error("La lecture de la branche distante a échoué", e, had_credentials))?
                .into_iter()
                .find(|head| head.name() == format!("refs/heads/{branch_name}"))
                .ok_or_else(|| AppError::InvalidInput(format!("La branche distante '{branch_name}' n'existe pas sur le remote '{remote}'.")))?;
            repo.reference(
                &remote_ref_name,
                remote_head.oid(),
                true,
                "Update remote tracking branch",
            )
            .map_err(|e| {
                AppError::Internal(format!("Unable to update remote tracking branch: {e}"))
            })?
        }
    };
    let remote_oid = remote_branch
        .target()
        .ok_or_else(|| AppError::Internal("Remote branch has no target".into()))?;
    let remote_commit = repo
        .find_commit(remote_oid)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let head = repo.head().map_err(|e| AppError::Internal(e.to_string()))?;
    let head_oid = head
        .target()
        .ok_or_else(|| AppError::Internal("HEAD has no target".into()))?;

    if head_oid == remote_oid {
        return Ok(());
    }

    let merge_base = repo
        .merge_base(head_oid, remote_oid)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if merge_base == remote_oid {
        // Local branch already contains remote branch.
        return Ok(());
    }

    if merge_base == head_oid {
        // Fast-forward possible.
        let tree = remote_commit
            .tree()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        repo.checkout_tree(tree.as_object(), None)
            .map_err(|e| AppError::Internal(format!("Checkout failed: {e}")))?;
        repo.reference("HEAD", remote_oid, true, "pull: fast-forward")
            .map_err(|e| AppError::Internal(e.to_string()))?;
        return Ok(());
    }

    // Otherwise perform a merge commit.
    let head_commit = repo
        .find_commit(head_oid)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let annotated = repo
        .find_annotated_commit(remote_oid)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    repo.merge(&[&annotated], None, None)
        .map_err(|e| AppError::Internal(format!("Merge failed: {e}")))?;

    let mut index = repo
        .index()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    if index.has_conflicts() {
        return Err(AppError::InvalidInput(
            "Pull resulted in merge conflicts. Resolve conflicts in your working tree and commit manually.".into()
        ));
    }

    let tree_oid = index
        .write_tree()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let tree = repo
        .find_tree(tree_oid)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let sig = repo
        .signature()
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
    )
    .map_err(|e| AppError::Internal(e.to_string()))?;

    repo.checkout_head(None)
        .map_err(|e| AppError::Internal(format!("Checkout failed: {e}")))?;
    repo.cleanup_state().ok();

    Ok(())
}

#[tauri::command]
pub async fn git_clone(
    url: String,
    dest_path: String,
    credentials: Option<GitCredentials>,
    state: State<'_, GitRepoState>,
) -> Result<(), AppError> {
    validate_remote_url(&url)?;

    let dest = PathBuf::from(&dest_path);

    if is_system_directory(&dest) {
        return Err(AppError::InvalidInput(format!(
            "Destination path '{}' is in a system directory.",
            dest_path
        )));
    }

    let had_credentials = credentials.is_some();
    let callbacks = remote_callbacks(credentials);
    let mut fetch_options = FetchOptions::new();
    fetch_options.remote_callbacks(callbacks);
    let mut builder = git2::build::RepoBuilder::new();
    builder.fetch_options(fetch_options);
    let _repo = builder
        .clone(&url, &dest)
        .map_err(|e| remote_op_error("Le clonage du dépôt distant a échoué", e, had_credentials))?;
    state.set_path(dest)?;
    Ok(())
}

#[tauri::command]
pub async fn git_write_collection_file(
    name: String,
    id: String,
    content: String,
    repo_dir: String,
    _state: State<'_, GitRepoState>,
) -> Result<(), AppError> {
    let repo_path = PathBuf::from(&repo_dir);

    if is_system_directory(&repo_path) {
        return Err(AppError::InvalidInput(format!(
            "Path '{}' is in a system directory and cannot be used for a git repository.",
            repo_dir
        )));
    }

    if !is_valid_git_repo(&repo_path) {
        return Err(AppError::InvalidInput(format!(
            "Path '{}' is not a valid git repository.",
            repo_dir
        )));
    }

    let collections_dir = repo_path.join("collections");
    std::fs::create_dir_all(&collections_dir)
        .map_err(|e| AppError::Internal(format!("Failed to create dir: {e}")))?;
    let safe_name = name.replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "_");
    let safe_id = id.replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "_");
    let filepath = collections_dir.join(format!("{}_{}.json", safe_name, safe_id));
    std::fs::write(&filepath, content)
        .map_err(|e| AppError::Internal(format!("Failed to write {filepath:?}: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn git_stash_save(
    message: Option<String>,
    state: State<'_, GitRepoState>,
) -> Result<String, AppError> {
    let mut repo = state.open_repo()?;
    let sig = git2::Signature::now("Reqly User", "user@reqly.local")
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let msg_ref = message.as_deref();
    let oid = repo
        .stash_save(&sig, msg_ref.unwrap_or("WIP on local changes"), None)
        .map_err(|e| AppError::Internal(format!("git stash save failed: {e}")))?;
    Ok(oid.to_string())
}

#[tauri::command]
pub async fn git_stash_pop(
    index: Option<usize>,
    state: State<'_, GitRepoState>,
) -> Result<(), AppError> {
    let mut repo = state.open_repo()?;
    let idx = index.unwrap_or(0);
    repo.stash_pop(idx, None)
        .map_err(|e| AppError::Internal(format!("git stash pop failed: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn git_stash_apply(
    index: Option<usize>,
    state: State<'_, GitRepoState>,
) -> Result<(), AppError> {
    let mut repo = state.open_repo()?;
    let idx = index.unwrap_or(0);
    repo.stash_apply(idx, None)
        .map_err(|e| AppError::Internal(format!("git stash apply failed: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn git_stash_drop(
    index: Option<usize>,
    state: State<'_, GitRepoState>,
) -> Result<(), AppError> {
    let mut repo = state.open_repo()?;
    let idx = index.unwrap_or(0);
    repo.stash_drop(idx)
        .map_err(|e| AppError::Internal(format!("git stash drop failed: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn git_stash_list(
    state: State<'_, GitRepoState>,
) -> Result<Vec<GitStashEntry>, AppError> {
    let mut repo = state.open_repo()?;
    let stashes = RefCell::new(Vec::<GitStashEntry>::new());

    repo.stash_foreach(|idx, name, oid| {
        stashes.borrow_mut().push(GitStashEntry {
            index: idx,
            message: name.to_string(),
            oid: oid.to_string(),
        });
        true
    })
    .map_err(|e| AppError::Internal(format!("git stash list failed: {e}")))?;

    Ok(stashes.into_inner())
}

#[cfg(test)]
mod path_validation_tests {
    use super::{is_private_ip, is_reserved_git_host, is_system_directory, is_within_base};
    use std::path::Path;

    #[test]
    fn system_directories_are_rejected() {
        #[cfg(unix)]
        {
            assert!(is_system_directory(Path::new("/etc")));
            assert!(is_system_directory(Path::new("/usr/share")));
        }
        #[cfg(windows)]
        {
            assert!(is_system_directory(Path::new(r"C:\Windows\System32")));
        }
    }

    #[test]
    fn normal_user_paths_are_allowed() {
        #[cfg(unix)]
        {
            assert!(!is_system_directory(Path::new("/home/user/project")));
        }
        #[cfg(windows)]
        {
            assert!(!is_system_directory(Path::new(
                r"C:\Users\alex\Documents\project"
            )));
        }
    }

    #[test]
    fn within_base_requires_containment() {
        let tmp = tempfile::TempDir::new().unwrap();
        let base = tmp.path();
        let inside = base.join("repo");
        std::fs::create_dir_all(&inside).unwrap();
        let outside = base.parent().unwrap().join("outside-anywhere");
        assert!(is_within_base(&inside, base));
        assert!(!is_within_base(&outside, base));
        assert!(!is_within_base(base, &outside));
    }

    #[test]
    fn private_ipv4_ranges_are_detected() {
        for ip in [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "169.254.169.254",
            "0.0.0.0",
            "100.64.0.1",
            "198.18.0.1",
            "192.0.2.1",
        ] {
            assert!(
                is_private_ip(ip.parse().unwrap()),
                "{} should be private",
                ip
            );
        }
    }

    #[test]
    fn public_ipv4_is_allowed() {
        for ip in ["8.8.8.8", "1.1.1.1", "140.82.112.3", "172.32.0.1"] {
            assert!(
                !is_private_ip(ip.parse().unwrap()),
                "{} should be public",
                ip
            );
        }
    }

    #[test]
    fn private_ipv6_ranges_are_detected() {
        for ip in ["::1", "fc00::1", "fe80::1", "::ffff:10.0.0.1", "::"] {
            assert!(
                is_private_ip(ip.parse().unwrap()),
                "{} should be private",
                ip
            );
        }
    }

    #[test]
    fn reserved_hostnames_are_rejected() {
        for url in [
            "http://localhost/repo.git",
            "http://intranet.local/repo.git",
            "http://git.internal/repo.git",
            "http://server.lan/repo.git",
            "http://10.0.0.5:8080/repo.git",
            "http://169.254.169.254/latest/meta-data",
        ] {
            let parsed = reqwest::Url::parse(url).unwrap();
            assert!(is_reserved_git_host(&parsed), "{} should be reserved", url);
        }
    }

    #[test]
    fn public_hosts_are_allowed() {
        for url in [
            "https://github.com/user/repo.git",
            "https://gitlab.com/user/repo.git",
            "https://gitea.example.org/user/repo.git",
        ] {
            let parsed = reqwest::Url::parse(url).unwrap();
            assert!(!is_reserved_git_host(&parsed), "{} should be allowed", url);
        }
    }

    #[test]
    fn ref_names_are_validated() {
        use super::{validate_ref_name, validate_remote_name};
        for ok in ["origin", "upstream-2", "feature/valid_x", "v1.2.3", "a"] {
            assert!(
                validate_ref_name(ok, "test").is_ok(),
                "{} should be valid",
                ok
            );
        }
        for bad in [
            "",
            "a b",
            "origin;rm -rf /",
            "x\"y",
            "x'y",
            "..",
            "@",
            "a\tb",
            "a\\b",
        ] {
            assert!(
                validate_ref_name(bad, "test").is_err(),
                "{} should be rejected",
                bad
            );
        }
        // Remotes : pas de slash
        assert!(validate_remote_name("origin").is_ok());
        assert!(validate_remote_name("feature/x").is_err());
    }

    #[test]
    fn push_branch_names_are_validated_before_refspec_interpolation() {
        // SEC-5 : git_push / git_push_force valident la branche avant
        // l'interpolation dans la refspec `refs/heads/{branch}:…`. La
        // validation doit court-circuiter pour ces noms d'injection.
        use super::validate_ref_name;
        for bad in [
            "",
            "a b",
            "..",
            "-leading-dash",
            "-oProxyCommand=evil",
            "origin;rm -rf /",
        ] {
            assert!(
                validate_ref_name(bad, "Nom de branche").is_err(),
                "{bad:?} should be rejected"
            );
        }
        for ok in ["main", "feature/login", "release/v2.0", "fix_1"] {
            assert!(
                validate_ref_name(ok, "Nom de branche").is_ok(),
                "{ok:?} should be valid"
            );
        }
    }
}
