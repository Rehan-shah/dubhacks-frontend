"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Show, UserButton, useUser } from "@clerk/nextjs";

export function AuthControls({ enabled }: { enabled: boolean }) {
  if (!enabled)
    return (
      <Link href="/sign-in" className="text-sm text-fg">
        Log in
      </Link>
    );
  return (
    <>
      <Show when="signed-out">
        <Link href="/sign-in" className="text-sm text-fg">
          Log in
        </Link>
        <Link
          href="/sign-up"
          className="text-sm text-fg"
        >
          Sign up
        </Link>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </>
  );
}

export function WelcomeGreeting({ enabled }: { enabled: boolean }) {
  return enabled ? <ClerkGreeting /> : <>Hi, skater</>;
}

function ClerkGreeting() {
  const { user } = useUser();
  return <>Hi, {user?.firstName || user?.fullName || user?.username || "skater"}</>;
}

/** Renders children only for a signed-in user; nothing when signed out or auth is off. */
export function SignedInOnly({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return enabled ? <Show when="signed-in">{children}</Show> : null;
}
