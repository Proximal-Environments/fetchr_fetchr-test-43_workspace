/* eslint-disable */
import { supabase } from "./supabase";
import { userService } from "./fetchr/base/service_injection/global";
import { UserProfile } from "./proto/base/base";

export async function getUserFromAuthHeader(
  authHeader: string | undefined
): Promise<UserProfile | undefined> {
  const {
    data: { user: userDb },
  } = await supabase.auth.getUser(authHeader);
  const userId = userDb?.id;
  const user = userId ? await userService.getUserOrFail(userId) : undefined;
  return user;
}
