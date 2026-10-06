"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession } from "@/lib/auth/session";

const loginSchema = z.object({
  email: z.string().trim().min(1, "이메일을 입력해주세요.").email("이메일 형식이 올바르지 않습니다."),
  password: z.string().min(1, "비밀번호를 입력해주세요."),
});

export type LoginState = {
  error?: string;
};

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "입력값을 확인해주세요." };
  }

  const { email, password } = parsed.data;

  let user;
  try {
    [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  } catch {
    return { error: "데이터베이스에 연결할 수 없습니다. DATABASE_URL 설정을 확인해주세요." };
  }

  if (!user || !user.isActive) {
    return { error: "이메일 또는 비밀번호가 올바르지 않습니다." };
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);
  if (!passwordMatches) {
    return { error: "이메일 또는 비밀번호가 올바르지 않습니다." };
  }

  await createSession({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });

  redirect("/dashboard");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
