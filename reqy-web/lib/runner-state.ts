export function resolveSelectedCollectionId<T extends { id: string }>(
  collections: T[],
  selectedId: string,
): string {
  if (selectedId && collections.some((collection) => collection.id === selectedId)) {
    return selectedId;
  }

  return collections[0]?.id ?? "";
}
