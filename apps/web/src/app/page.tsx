import { redirect } from "next/navigation";
import { requirePageSession } from "@/server/auth";

export default async function Home() {
  await requirePageSession();
  redirect("/app/projects");
}
