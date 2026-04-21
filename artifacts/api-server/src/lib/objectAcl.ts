import { File } from "@google-cloud/storage";

// MysticsHR uses application-level ACLs (see storage.ts → userCanAccessAttachment)
// rather than per-object metadata ACLs, so this module exposes only the minimal
// surface that objectStorage.ts imports. The functions still read/write the
// "custom:aclPolicy" metadata key for forward-compat with the platform's storage
// utilities, but no group/visibility evaluation is performed here.

const ACL_POLICY_METADATA_KEY = "custom:aclPolicy";

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
}

export async function setObjectAclPolicy(objectFile: File, aclPolicy: ObjectAclPolicy): Promise<void> {
  const [exists] = await objectFile.exists();
  if (!exists) throw new Error(`Object not found: ${objectFile.name}`);
  await objectFile.setMetadata({
    metadata: { [ACL_POLICY_METADATA_KEY]: JSON.stringify(aclPolicy) },
  });
}

export async function getObjectAclPolicy(objectFile: File): Promise<ObjectAclPolicy | null> {
  const [metadata] = await objectFile.getMetadata();
  const raw = metadata?.metadata?.[ACL_POLICY_METADATA_KEY];
  if (!raw) return null;
  try { return JSON.parse(raw as string) as ObjectAclPolicy; } catch { return null; }
}

// Application-level callers (e.g. helpdesk attachments) own access decisions.
// This helper only reflects the bucket-level visibility flag if present.
export async function canAccessObject({
  objectFile,
  requestedPermission,
}: {
  userId?: string;
  objectFile: File;
  requestedPermission: ObjectPermission;
}): Promise<boolean> {
  const aclPolicy = await getObjectAclPolicy(objectFile);
  if (!aclPolicy) return false;
  return aclPolicy.visibility === "public" && requestedPermission === ObjectPermission.READ;
}
