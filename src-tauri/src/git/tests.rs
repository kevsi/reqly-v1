#[cfg(test)]
mod tests {
    use crate::git::commands::GitRepoState;
    use tempfile::TempDir;

    fn setup_repo() -> (TempDir, GitRepoState) {
        let tmp = TempDir::new().unwrap();
        let repo = git2::Repository::init(tmp.path()).unwrap();
        // Disable autocrlf to avoid CRLF issues on Windows
        let mut config = repo.config().unwrap();
        config.set_str("core.autocrlf", "false").unwrap();

        // Créer un fichier initial et le commiter
        std::fs::write(tmp.path().join("hello.txt"), "hello world").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path("hello.txt".as_ref()).unwrap();
        index.write().unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_oid).unwrap();
        let sig = git2::Signature::now("Test", "test@test.com").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
            .unwrap();

        let state = GitRepoState::new();
        state.set_path(tmp.path().to_path_buf());
        (tmp, state)
    }

    #[test]
    fn test_status_clean() {
        let (_tmp, state) = setup_repo();
        let repo = state.open_repo().unwrap();
        let statuses = repo.statuses(None).unwrap();
        assert_eq!(statuses.len(), 0);
    }

    #[test]
    fn test_status_modified() {
        let (tmp, state) = setup_repo();
        std::fs::write(tmp.path().join("hello.txt"), "modified content").unwrap();
        let repo = state.open_repo().unwrap();
        let mut opts = git2::StatusOptions::new();
        opts.include_untracked(true);
        let statuses = repo.statuses(Some(&mut opts)).unwrap();
        assert_eq!(statuses.len(), 1);
        assert!(statuses
            .get(0)
            .unwrap()
            .status()
            .contains(git2::Status::WT_MODIFIED));
    }

    #[test]
    fn test_commit() {
        let (tmp, state) = setup_repo();
        // Modifier et commiter
        std::fs::write(tmp.path().join("hello.txt"), "v2").unwrap();
        let repo = state.open_repo().unwrap();
        let mut index = repo.index().unwrap();
        index.add_path("hello.txt".as_ref()).unwrap();
        index.write().unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_oid).unwrap();
        let parent = repo.head().unwrap().target().unwrap();
        let parent_commit = repo.find_commit(parent).unwrap();
        let sig = git2::Signature::now("Test", "test@test.com").unwrap();
        repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            "Second commit",
            &tree,
            &[&parent_commit],
        )
        .unwrap();

        // Vérifier le log
        let mut revwalk = repo.revwalk().unwrap();
        revwalk.push_head().unwrap();
        let commits: Vec<_> = revwalk.collect::<Result<Vec<_>, _>>().unwrap();
        assert_eq!(commits.len(), 2);
    }

    #[test]
    fn test_branch_create_and_switch() {
        let (_tmp, state) = setup_repo();
        let repo = state.open_repo().unwrap();

        // Créer une branche
        let head = repo.head().unwrap();
        let oid = head.target().unwrap();
        let commit = repo.find_commit(oid).unwrap();
        repo.branch("feature", &commit, false).unwrap();

        // Lister les branches
        let branches: Vec<_> = repo
            .branches(None)
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(branches.len(), 2); // main + feature

        // Switch
        let branch = repo
            .find_branch("feature", git2::BranchType::Local)
            .unwrap();
        let branch_oid = branch.get().target().unwrap();
        let branch_commit = repo.find_commit(branch_oid).unwrap();
        let tree = branch_commit.tree().unwrap();
        repo.checkout_tree(tree.as_object(), None).unwrap();
        repo.set_head("refs/heads/feature").unwrap();

        assert_eq!(repo.head().unwrap().shorthand().unwrap(), "feature");
    }

    #[test]
    fn test_diff() {
        let (tmp, state) = setup_repo();
        let repo = state.open_repo().unwrap();

        // Premier commit
        let oid1 = repo.head().unwrap().target().unwrap();

        // Second commit
        std::fs::write(tmp.path().join("hello.txt"), "changed").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path("hello.txt".as_ref()).unwrap();
        index.write().unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_oid).unwrap();
        let parent = repo.find_commit(oid1).unwrap();
        let sig = git2::Signature::now("Test", "test@test.com").unwrap();
        let oid2 = repo
            .commit(Some("HEAD"), &sig, &sig, "Second", &tree, &[&parent])
            .unwrap();

        // Diff
        let tree1 = repo.find_commit(oid1).unwrap().tree().unwrap();
        let tree2 = repo.find_commit(oid2).unwrap().tree().unwrap();
        let diff = repo
            .diff_tree_to_tree(Some(&tree1), Some(&tree2), None)
            .unwrap();
        assert_eq!(diff.deltas().len(), 1);
        assert_eq!(
            diff.deltas().next().unwrap().status(),
            git2::Delta::Modified
        );
    }
}
