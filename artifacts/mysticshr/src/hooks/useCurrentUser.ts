import { useCurrentHrmsUser } from "@/lib/useCurrentHrmsUser";

export function useCurrentUser() {
  const { hrmsUser, role, isLoading } = useCurrentHrmsUser();
  return { user: hrmsUser, role, isLoading };
}
