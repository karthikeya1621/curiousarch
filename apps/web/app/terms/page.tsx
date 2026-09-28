import type { Metadata } from "next";
import { LegalPage } from "../../components/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for using CuriousArch.",
  alternates: { canonical: "/terms" },
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>By creating an account, starting a guest session or otherwise using CuriousArch you agree to these terms. If you do not agree, please do not use it.</p>

      <h2>The service</h2>
      <p>CuriousArch uses AI to draw an architecture from your description and to point out where it may fail as traffic grows. It is a learning and planning aid.</p>

      <h2>It can be wrong</h2>
      <p>Results are AI-generated estimates and opinions, not engineering, financial or security advice, and they have not been verified by a professional architect. Review them before relying on them for a real system. We give no guarantee that a design will perform, scale or stay secure.</p>

      <h2>Free use and limits</h2>
      <p>Free use is limited (currently one project with one build, one Re-simulate and a small number of chat messages per account). We may change, reduce or end free use, and introduce paid plans or credits, at any time. Guest sessions and their data are deleted after a short period unless you sign in.</p>

      <h2>Your content</h2>
      <p>You own what you write and the diagrams built from it. You give us permission to store it, send it to our AI and infrastructure providers, and process it to run the service, as described in the Privacy Policy. You are responsible for having the right to submit it and for not including secrets or other people&apos;s personal data.</p>

      <h2>Acceptable use</h2>
      <ul>
        <li>No attempts to bypass usage limits, create accounts in bulk, or disrupt the service.</li>
        <li>No automated access other than through the app as provided.</li>
        <li>No unlawful content, and no attempts to extract or misuse the AI provider&apos;s systems through the service.</li>
      </ul>
      <p>We may suspend or remove access for misuse.</p>

      <h2>Availability</h2>
      <p>The service is provided &quot;as is&quot; and &quot;as available&quot;. It may be interrupted, and features may change.</p>

      <h2>Liability</h2>
      <p>To the extent the law allows, we are not liable for indirect or consequential loss, loss of data, profits or business, or for decisions you make based on the results. Nothing here limits liability that cannot be limited by law.</p>

      <h2>Ending</h2>
      <p>You can stop using the service and ask us to delete your account at any time. We may end or change the service with reasonable notice where practical.</p>

      <h2>Changes and contact</h2>
      <p>We may update these terms; continued use after a change means you accept it. Questions go to the address below.</p>
    </LegalPage>
  );
}
