import { ComposeClient } from "./compose-client";
import "./compose.css";

export const metadata = {
  title: "Compose — AI Engineering Cockpit",
  description: "Turn an idea into a structured, hash-ready task brief.",
};

export default function ComposePage() {
  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">FROM INTENT TO IMPACT</p>
          <h1 className="page-title">Start with what<br className="desktop-break" /> you have in mind.</h1>
          <p className="page-sub">
            Describe the change in your own words. SkillHub turns it into a transparent brief you can shape, then asks you before an agent takes action.
          </p>
        </div>
      </header>
      <ComposeClient />
    </>
  );
}
