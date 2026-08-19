export function canWriteOutcome(args: {
  isServiceRole: boolean;
  authenticatedUserId: string | null;
  snapshotUserId: string | null;
}): boolean {
  if (args.isServiceRole) return true;
  return !!args.authenticatedUserId &&
    !!args.snapshotUserId &&
    args.authenticatedUserId === args.snapshotUserId;
}
