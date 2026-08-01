import type { CollectionFolder, RequestItem } from "@/hooks/use-request-store"

export function getTotalCount(
  folder: CollectionFolder,
  folders: CollectionFolder[],
  requests: RequestItem[]
): number {
  const direct = requests.filter((r) => r.folderId === folder.id).length
  const children = folders.filter((f) => f.parentId === folder.id)
  return direct + children.reduce((acc, c) => acc + getTotalCount(c, folders, requests), 0)
}

export function flattenFolderTree(
  parentId: string | null,
  folders: CollectionFolder[],
  depth: number,
  visit: (folder: CollectionFolder, depth: number) => void
): void {
  folders
    .filter((f) => f.parentId === parentId)
    .forEach((folder) => {
      visit(folder, depth)
      flattenFolderTree(folder.id, folders, depth + 1, visit)
    })
}
