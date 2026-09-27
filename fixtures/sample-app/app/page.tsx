import { greet } from "../lib/greet";

export default function Home() {
  return (
    <main>
      <h1>Sample App</h1>
      <p>{greet("world")}</p>
    </main>
  );
}
