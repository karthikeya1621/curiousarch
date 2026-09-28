import type { Metadata } from "next";
import { LegalPage } from "../../components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What CuriousArch collects, why, who processes it, and how long it is kept.",
  alternates: { canonical: "/privacy" },
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        CuriousArch turns a plain-English description of a system into an architecture diagram and analyses where it breaks. This page says
        what we collect to do that, who else handles it, and how long we keep it.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account:</strong> your email address (and, if you use Google sign-in, your Google name, email and profile picture). A guest account has no email and is identified by a random ID.</li>
        <li><strong>Your work:</strong> the system descriptions you write, the diagrams and versions built from them, findings, queued changes and chat messages. Saved projects are stored against your account.</li>
        <li><strong>AI usage records:</strong> for each AI request, which action it was, the model, token counts, cost, timing and outcome. We keep these to run the service and control cost.</li>
        <li><strong>Prompts and responses:</strong> the full text sent to and returned by the AI is stored for debugging and quality checks and deleted after 30 days.</li>
        <li><strong>Guest trial:</strong> for guest accounts only, a salted one-way hash of your IP address, used to limit how many trials one network can start. We do not store the address itself.</li>
        <li><strong>On your device:</strong> a sign-in session cookie, your theme choice, and the ID of the project you last had open.</li>
      </ul>

      <h2>Why, and on what basis</h2>
      <p>To provide the service you asked for (building, saving and analysing systems), to keep it secure and prevent abuse (quota limits, IP hashing), and to understand and control its running costs. We do not sell your data and do not use it for advertising.</p>

      <h2>Who else handles your data</h2>
      <ul>
        <li><strong>Anthropic</strong> receives your descriptions, diagrams and chat messages to generate results. Their handling is governed by their own terms and privacy policy.</li>
        <li><strong>Supabase</strong> hosts our database and authentication.</li>
        <li><strong>Google</strong>, if you choose Google sign-in.</li>
        <li><strong>hCaptcha</strong>, only if a bot check is shown when starting a guest session.</li>
        <li><strong>Our hosting provider</strong> serves the site and sees standard request data such as IP address.</li>
      </ul>

      <h2>Please do not put secrets in a description</h2>
      <p>Descriptions are sent to a third-party AI service. Do not include passwords, API keys, personal data about other people, or confidential company information you are not free to share.</p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Projects and account: until you delete them or ask us to.</li>
        <li>Prompts and responses: 30 days.</li>
        <li>Usage records (no prompt text): kept to account for cost.</li>
        <li>Guest accounts and their projects: deleted automatically after about 30 days unless upgraded by signing in.</li>
      </ul>

      <h2>Your choices</h2>
      <p>You can delete a project in the app at any time. You can ask us to access, correct, export or delete your data, or your whole account, using the contact address below. If you are in the EU/UK you also have the right to complain to your data protection authority.</p>

      <h2>Security</h2>
      <p>Traffic is encrypted in transit, projects are protected by per-user access rules in the database, and AI usage tables can only be written by our server. No system is perfectly secure; tell us if you find a problem.</p>

      <h2>Children</h2>
      <p>The service is not directed at children under 16.</p>

      <h2>Changes</h2>
      <p>If this policy changes in a meaningful way we will update the date above and, where appropriate, tell you in the app.</p>
    </LegalPage>
  );
}
